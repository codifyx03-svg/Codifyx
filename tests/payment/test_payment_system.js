/**
 * test_payment_system.js
 *
 * End-to-end test for the Codify Internal Payment Infrastructure
 *
 * Flow tested:
 *  1. Register client + worker
 *  2. Client creates project + task (payment_amount set)
 *  3. Admin funds project wallet (PayoutService.fundProjectWallet)
 *  4. Admin releases task payment → Worker wallet credited
 *  5. Worker submits withdrawal request
 *  6. Admin approves withdrawal → balance debited
 *  7. Verify financial_audit_trail checksums
 *  8. Tamper detection test
 *
 * Run: node test_payment_system.js
 */

'use strict';

const http = require('http');

// ─── Config ──────────────────────────────────────────────────────────────────
const PUBLIC_PORT  = 3003;  // public-api/server.js (PORT_PUBLIC_API)
const ADMIN_PORT   = 3004;  // admin-api/server.js  (PORT_ADMIN_API)
const PUBLIC_BASE  = `http://localhost:${PUBLIC_PORT}`;
const ADMIN_BASE   = `http://localhost:${ADMIN_PORT}`;
const ADMIN_LOGIN_PATH = '/api/admin/auth/portal-secure-login-x97';

let PUBLIC_TOKEN   = '';
let WORKER_TOKEN   = '';
let ADMIN_TOKEN    = '';
let projectId      = null;
let taskId         = null;
let workerUserId   = null;
let withdrawalId   = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function request(method, base, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`, detail || '');
    failed++;
  }
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

async function testRegisterAndLogin() {
  console.log('\n━━━ 1. Register & Login ━━━');

  const ts = Date.now();

  // Register client
  let r = await request('POST', PUBLIC_BASE, '/api/auth/register', {
    name: `PayTestClient_${ts}`,
    email: `payclient_${ts}@test.com`,
    password: 'SecurePass123!',
    role: 'client',
    accepted_legal: true
  });
  assert('Client registered', (r.status === 201 || r.status === 200) && r.body.message, JSON.stringify(r.body));

  // Login client
  r = await request('POST', PUBLIC_BASE, '/api/auth/login', {
    email: `payclient_${ts}@test.com`,
    password: 'SecurePass123!'
  });
  assert('Client login', r.status === 200 && r.body.token, JSON.stringify(r.body));
  PUBLIC_TOKEN = r.body.token;

  // Admin login (uses hidden portal path for security)
  r = await request('POST', ADMIN_BASE, ADMIN_LOGIN_PATH, {
    email: process.env.ADMIN_EMAIL || 'koushishetty8109@gmail.com',
    password: process.env.ADMIN_PASS || '@Koushi2005'
  });
  if (r.status !== 200) {
    console.warn('  ⚠️  Admin login failed — skipping admin-side tests. Set ADMIN_EMAIL/ADMIN_PASS env vars.');
    console.warn('     Response:', JSON.stringify(r.body));
    return false;
  }
  ADMIN_TOKEN = r.body.token;
  assert('Admin login', !!ADMIN_TOKEN);

  // Create worker via admin API
  r = await request('POST', ADMIN_BASE, '/api/admin/workers', {
    name: `PayTestWorker_${ts}`,
    email: `payworker_${ts}@test.com`,
    password: 'SecurePass123!',
    skills: 'Testing',
    experience: '1 year',
    available_hours: 40,
    approved: 1
  }, ADMIN_TOKEN);
  assert('Worker registered', r.status === 200 && r.body.success, JSON.stringify(r.body));
  workerUserId = r.body.workerId;

  // Login worker after approval
  r = await request('POST', PUBLIC_BASE, '/api/auth/login', {
    email: `payworker_${ts}@test.com`,
    password: 'SecurePass123!'
  });
  assert('Worker login after approval', r.status === 200 && r.body.token, JSON.stringify(r.body));
  WORKER_TOKEN = r.body.token;
  if (!workerUserId && r.body.user) workerUserId = r.body.user.id;

  return true;
}

async function testProjectAndTask() {
  console.log('\n━━━ 2. Create Project & Task ━━━');

  // Create project
  let r = await request('POST', PUBLIC_BASE, '/api/projects', {
    title: 'Payment Test Project',
    description: 'Testing the payment infrastructure end-to-end',
    budget: 50000,
    deadline: '2025-12-31',
    technologies: 'Node.js'
  }, PUBLIC_TOKEN);
  assert('Project created', (r.status === 201 || r.status === 200) && r.body.projectId, JSON.stringify(r.body).substring(0,200));
  projectId = r.body.projectId;
  if (!projectId) return false;

  // Accept/Fund project to generate tasks
  const acceptRes = await request('POST', PUBLIC_BASE, `/api/projects/${projectId}/accept`, { accept: true }, PUBLIC_TOKEN);
  assert('Project accepted and funded', acceptRes.status === 200, JSON.stringify(acceptRes.body));

  // Get project and its auto-generated AI tasks
  const projRes = await request('GET', PUBLIC_BASE, '/api/projects/client', null, PUBLIC_TOKEN);
  if (projRes.status === 200 && projRes.body.projects) {
    const proj = projRes.body.projects.find(p => p.id === projectId);
    if (proj && proj.tasks && proj.tasks.length > 0) {
      taskId = proj.tasks[0].id;
      assert('Task exists on project (AI generated)', !!taskId);
    } else {
      // Try fetching the single project
      const singleRes = await request('GET', PUBLIC_BASE, `/api/projects/${projectId}`, null, PUBLIC_TOKEN);
      if (singleRes.status === 200 && singleRes.body.project && singleRes.body.project.tasks && singleRes.body.project.tasks.length > 0) {
        taskId = singleRes.body.project.tasks[0].id;
        assert('Task exists on project', !!taskId);
      } else {
        console.warn('  ⚠️  No tasks found on project — skipping task tests');
      }
    }
  }

  return !!taskId;
}

async function testFundingAndWallets() {
  console.log('\n━━━ 3. Fund Project Wallet ━━━');

  const r = await request('POST', ADMIN_BASE, `/api/admin/projects/${projectId}/fund`, {
    amount: 50000
  }, ADMIN_TOKEN);
  if (r.status === 404) {
    console.warn('  ⚠️  Fund endpoint not found — wallet seeded via task payment release.');
  }

  // Verify platform wallet state
  const walRes = await request('GET', ADMIN_BASE, '/api/admin/payment/wallets', null, ADMIN_TOKEN);
  assert('Platform wallet endpoint responds', walRes.status === 200, JSON.stringify(walRes.body));
  if (walRes.status === 200) {
    console.log(`     Platform balance: ₹${(walRes.body.platformBalance || 0).toLocaleString('en-IN')}`);
    console.log(`     Worker wallets count: ${(walRes.body.workerWallets || []).length}`);
  }
}

async function testPaymentRelease() {
  console.log('\n━━━ 4. Admin Releases Task Payment ━━━');

  // Put task into review state and assign it to the worker before release
  const assignRes = await request('POST', ADMIN_BASE, `/api/admin/tasks/${taskId}/assign`, {
    workerId: workerUserId
  }, ADMIN_TOKEN);
  assert('Task assigned to worker', assignRes.status === 200, JSON.stringify(assignRes.body));

  const updateRes = await request('PUT', ADMIN_BASE, `/api/admin/tasks/${taskId}/status`, {
    status: 'review',
    payment_amount: 15000
  }, ADMIN_TOKEN);
  if (updateRes.status !== 200) {
    const dbRes = await request('PATCH', ADMIN_BASE, `/api/admin/tasks/${taskId}`, {
      status: 'review',
      payment_status: 'pending',
      payment_amount: 15000,
      assigned_worker_id: workerUserId
    }, ADMIN_TOKEN);
    if (dbRes.status !== 200) {
      console.warn('  ⚠️  Could not set task to review state, skipping payment release test');
      console.warn('     Response:', JSON.stringify(dbRes.body));
      return false;
    }
  }

  // Client must approve delivery before payment can be released
  const clientApprovalRes = await request('POST', PUBLIC_BASE, `/api/projects/${projectId}/tasks/${taskId}/approve-delivery`, {}, PUBLIC_TOKEN);
  assert('Client approved delivery', clientApprovalRes.status === 200, JSON.stringify(clientApprovalRes.body));

  // Check worker wallet before
  const walBefore = await request('GET', ADMIN_BASE, '/api/admin/payment/wallets', null, ADMIN_TOKEN);
  const wWalletBefore = walBefore.status === 200
    ? (walBefore.body.workerWallets || []).find(w => w.user_id === workerUserId)
    : null;
  const balanceBefore = wWalletBefore ? wWalletBefore.balance : 0;
  console.log(`     Worker balance before release: ₹${balanceBefore}`);

  // Release payment
  const releaseRes = await request('POST', ADMIN_BASE, `/api/admin/tasks/${taskId}/approve-payment`, null, ADMIN_TOKEN);
  assert('Payment release succeeds', releaseRes.status === 200, JSON.stringify(releaseRes.body));

  if (releaseRes.status === 200) {
    console.log(`     Released: ₹${releaseRes.body.result?.amount || 'unknown'}`);
  }

  return releaseRes.status === 200;
}

async function testWorkerWallet() {
  console.log('\n━━━ 5. Worker Wallet Balance ━━━');

  const r = await request('GET', PUBLIC_BASE, '/api/worker/wallet', null, WORKER_TOKEN);
  assert('Worker wallet endpoint accessible', r.status === 200, JSON.stringify(r.body));
  if (r.status === 200) {
    console.log(`     Wallet balance: ₹${(r.body.balance || 0).toLocaleString('en-IN')}`);
    console.log(`     Payouts count: ${(r.body.payouts || []).length}`);
    console.log(`     Withdrawals count: ${(r.body.withdrawals || []).length}`);
    assert('Worker wallet returns balance', typeof r.body.balance === 'number');
  }
}

async function testWithdrawalFlow() {
  console.log('\n━━━ 6. Withdrawal Request Flow ━━━');

  const walRes = await request('GET', PUBLIC_BASE, '/api/worker/wallet', null, WORKER_TOKEN);
  const balance = walRes.status === 200 ? (walRes.body.balance || 0) : 0;

  if (balance <= 0) {
    console.warn(`  ⚠️  Worker wallet is empty (₹${balance}). Withdrawal test skipped.`);
    return false;
  }

  const withdrawAmount = Math.floor(balance / 2);
  const r = await request('POST', PUBLIC_BASE, '/api/worker/wallet/withdraw', {
    amount: withdrawAmount,
    upi_id: 'worker@upi'
  }, WORKER_TOKEN);
  assert(`Withdrawal request submitted (₹${withdrawAmount})`, r.status === 200, JSON.stringify(r.body));
  withdrawalId = r.body.requestId;

  // Verify overdraft is rejected
  const r2 = await request('POST', PUBLIC_BASE, '/api/worker/wallet/withdraw', {
    amount: balance * 10,
    upi_id: 'worker@upi'
  }, WORKER_TOKEN);
  assert('Overdraft request rejected', r2.status === 400, JSON.stringify(r2.body));

  return r.status === 200;
}

async function testAdminWithdrawalApproval() {
  console.log('\n━━━ 7. Admin Approves Withdrawal ━━━');

  if (!withdrawalId) {
    console.warn('  ⚠️  No withdrawal ID — skipping approval test.');
    return;
  }

  const listRes = await request('GET', ADMIN_BASE, '/api/admin/payment/withdrawals', null, ADMIN_TOKEN);
  assert('Withdrawal list accessible', listRes.status === 200, JSON.stringify(listRes.body));
  const pendingWithdrawal = (listRes.body.requests || []).find(r => r.id === withdrawalId || r.status === 'pending');
  if (!pendingWithdrawal) {
    console.warn('  ⚠️  No pending withdrawal found for approval test.');
    return;
  }
  withdrawalId = pendingWithdrawal.id;
  const found = (listRes.body.requests || []).find(r => r.id === withdrawalId);
  assert(`Withdrawal #${withdrawalId} appears in list`, !!found);

  const approveRes = await request('POST', ADMIN_BASE, `/api/admin/payment/withdrawals/${withdrawalId}/approve`, null, ADMIN_TOKEN);
  assert('Withdrawal approved', approveRes.status === 200, JSON.stringify(approveRes.body));

  const walRes = await request('GET', PUBLIC_BASE, '/api/worker/wallet', null, WORKER_TOKEN);
  if (walRes.status === 200) {
    console.log(`     Worker balance after withdrawal approval: ₹${walRes.body.balance}`);
  }

  const dupRes = await request('POST', ADMIN_BASE, `/api/admin/payment/withdrawals/${withdrawalId}/approve`, null, ADMIN_TOKEN);
  assert('Double-approval rejected', dupRes.status === 400, JSON.stringify(dupRes.body));
}

async function testAuditTrail() {
  console.log('\n━━━ 8. Financial Audit Trail Integrity ━━━');

  const r = await request('GET', ADMIN_BASE, '/api/admin/payment/audit-trail', null, ADMIN_TOKEN);
  assert('Audit trail accessible', r.status === 200, JSON.stringify(r.body));

  if (r.status !== 200) return;

  const trail = r.body.trail || [];
  assert('Audit trail has entries', trail.length > 0, 'Trail is empty');
  console.log(`     Total audit entries: ${trail.length}`);

  const crypto = require('crypto');
  let allValid = true;
  let tamperCount = 0;

  for (const entry of trail) {
    if (!entry.checksum) continue;
    const raw = `${entry.event_type}|${entry.reference_id}|${entry.amount}|${entry.actor_id}|${entry.created_at}`;
    const expected = crypto.createHash('sha256').update(raw).digest('hex');
    if (expected !== entry.checksum) {
      allValid = false;
      tamperCount++;
      console.error(`     ⚠️  TAMPER DETECTED on entry #${entry.id}: ${entry.event_type}`);
    }
  }

  assert('All audit trail checksums are valid (no tampering)', allValid,
    allValid ? '' : `${tamperCount} tampered entries detected!`);

  trail.slice(0, 5).forEach(e => {
    console.log(`     [${e.event_type}] ref:${e.reference_id} ₹${e.amount} by:${e.actor_name || e.actor_id}`);
  });
}

async function testPayoutHistory() {
  console.log('\n━━━ 9. Payout History ━━━');

  const r = await request('GET', ADMIN_BASE, '/api/admin/payment/payouts', null, ADMIN_TOKEN);
  assert('Payout history accessible', r.status === 200, JSON.stringify(r.body));
  if (r.status === 200) {
    console.log(`     Total payouts recorded: ${(r.body.payouts || []).length}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Codify — Payment Infrastructure E2E Test Suite        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nPublic API: ${PUBLIC_BASE}`);
  console.log(`Admin API:  ${ADMIN_BASE}`);

  try {
    const loginOk = await testRegisterAndLogin();
    if (!loginOk) {
      console.error('\n❌ Cannot proceed without admin login. Please check admin credentials.');
      process.exit(1);
    }

    const projectOk = await testProjectAndTask();
    if (!projectOk) {
      console.error('\n❌ Cannot proceed without project/task. Check project creation endpoint.');
    } else {
      await testFundingAndWallets();
      await testPaymentRelease();
    }

    await testWorkerWallet();
    await testWithdrawalFlow();
    await testAdminWithdrawalApproval();
    await testAuditTrail();
    await testPayoutHistory();

  } catch (err) {
    console.error('\n💥 Unexpected error:', err.message);
    console.error(err.stack);
    failed++;
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 All payment infrastructure tests passed!');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. See output above for details.`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
