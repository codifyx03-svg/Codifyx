const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();

const publicBase = 'http://localhost:3003';
const adminBase = 'http://localhost:3004';

async function main() {
  console.log('--- Starting Payout and Withdrawal flow test ---');

  // Direct login for admin
  let adminToken;
  try {
    const res = await fetch(`${adminBase}/api/admin/auth/portal-secure-login-x97`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'koushishetty8109@gmail.com', password: '@Koushi2005' })
    });
    const data = await res.json();
    adminToken = data.token;
    console.log('✅ Admin logged in successfully.');
  } catch (err) {
    console.error('Failed to log in as admin:', err.message);
    process.exit(1);
  }

  // Register worker
  const rand = Math.floor(Math.random() * 100000);
  const workerEmail = `worker_${rand}@example.com`;
  const workerPassword = 'Password1!';
  
  let workerToken, workerId;
  try {
    // 1. Create worker via Admin API
    const createRes = await fetch(`${adminBase}/api/admin/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Payout Worker',
        email: workerEmail,
        password: workerPassword,
        skills: 'Testing',
        experience: '1 year',
        available_hours: 40,
        approved: 1
      })
    });
    const createData = await createRes.json();
    if (!createData.success) throw new Error(createData.error || 'Worker creation failed');
    workerId = createData.workerId;
    console.log('✅ Worker created via Admin API:', workerId);

    // 3. Worker login
    const loginRes = await fetch(`${publicBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: workerEmail, password: workerPassword })
    });
    const loginData = await loginRes.json();
    workerToken = loginData.token;
    console.log('✅ Worker logged in.');

  } catch (err) {
    console.error('Registration/approval/login failed:', err.message);
    process.exit(1);
  }

  try {
    // Create a client user, project, task, and assign to worker
    const clientEmail = `client_${rand}@example.com`;
    const clientRes = await fetch(`${publicBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: clientEmail,
        name: 'Payout Client',
        role: 'client',
        password: 'Password1!',
        accepted_legal: true
      })
    });
    const clientData = await clientRes.json();
    
    await fetch(`${publicBase}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clientEmail, code: clientData.verificationCode })
    });

    const clientLoginRes = await fetch(`${publicBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clientEmail, password: 'Password1!' })
    });
    const clientLoginData = await clientLoginRes.json();
    const clientToken = clientLoginData.token;
    console.log('✅ Client registered and logged in.');

    // Submit project
    const projRes = await fetch(`${publicBase}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        title: 'Payout Test Project',
        description: 'Testing wallet release',
        budget: 5000,
        deadline: '2026-12-31'
      })
    });
    const projData = await projRes.json();
    const projectId = projData.projectId;
    console.log('✅ Project created:', projectId);

    await fetch(`${publicBase}/api/projects/${projectId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({ accept: true })
    });
    console.log('✅ Project budget accepted.');

    // Split project into a task
    // First get the project tasks or create task
    const tasksRes = await fetch(`${adminBase}/api/admin/projects/${projectId}/split`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        tasks: [
          { title: 'Task 1', description: 'Task description', payment_amount: 5000, paymentAmount: 5000, deadline: '2026-12-31' }
        ]
      })
    });
    const tasksData = await tasksRes.json();
    console.log('✅ Task split completed.');

    // Find the task ID
    const getProjRes = await fetch(`${adminBase}/api/admin/projects`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const getProjData = await getProjRes.json();
    const project = getProjData.projects.find(p => p.id === projectId);
    const taskId = project.tasks[0].id;
    console.log('✅ Task ID found:', taskId);

    // Worker claims the task
    const claimRes = await fetch(`${publicBase}/api/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    console.log('✅ Task claimed by worker.');

    // Worker submits task
    const submitRes = await fetch(`${publicBase}/api/tasks/${taskId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerToken}`
      },
      body: JSON.stringify({
        code_submission: 'console.log("hello world");',
        progress: 100
      })
    });
    console.log('✅ Task code submitted by worker.');

    // Fetch initial wallet balance
    let walletRes = await fetch(`${publicBase}/api/worker/wallet`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    let walletData = await walletRes.json();
    console.log('💵 Initial Worker Wallet Response:', JSON.stringify(walletData));

    // Client approves delivery before payment can be released
    const clientApproveRes = await fetch(`${publicBase}/api/projects/${projectId}/tasks/${taskId}/approve-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({ note: 'Great job!' })
    });
    const clientApproveData = await clientApproveRes.json();
    console.log('✅ Client approved delivery Response:', JSON.stringify(clientApproveData));

    // Admin approves payment / releases payment
    const approvePayRes = await fetch(`${adminBase}/api/admin/tasks/${taskId}/approve-payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const approvePayData = await approvePayRes.json();
    console.log('✅ Payment approved by Admin Response:', JSON.stringify(approvePayData));

    // Fetch updated wallet balance
    walletRes = await fetch(`${publicBase}/api/worker/wallet`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    walletData = await walletRes.json();
    console.log('💵 Updated Worker Wallet Response (after payout):', JSON.stringify(walletData));

    if (walletData.balance !== 5000) {
      throw new Error(`Expected balance to be 5000, got ${walletData.balance}`);
    }

    // Submit withdrawal request
    const withdrawReqRes = await fetch(`${publicBase}/api/worker/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerToken}`
      },
      body: JSON.stringify({
        amount: 3000,
        upi_id: 'worker@upi'
      })
    });
    const withdrawReqData = await withdrawReqRes.json();
    const requestId = withdrawReqData.requestId;
    console.log('✅ Withdrawal requested for ₹3000. Request ID:', requestId);

    // Check balance is unchanged (since it is only requested, not approved)
    walletRes = await fetch(`${publicBase}/api/worker/wallet`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    walletData = await walletRes.json();
    console.log('💵 Worker Balance (after request, before approval):', walletData.balance);

    // Admin reviews withdrawals
    const adminWithdrawalsRes = await fetch(`${adminBase}/api/admin/payment/withdrawals`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminWithdrawalsData = await adminWithdrawalsRes.json();
    console.log('📋 Admin Pending Withdrawals list count:', adminWithdrawalsData.requests.length);

    // Admin approves withdrawal request
    const approveWithdrawalRes = await fetch(`${adminBase}/api/admin/payment/withdrawals/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const approveWithdrawalData = await approveWithdrawalRes.json();
    console.log('✅ Withdrawal approved by Admin:', approveWithdrawalData.message);

    // Fetch final wallet balance
    walletRes = await fetch(`${publicBase}/api/worker/wallet`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    walletData = await walletRes.json();
    console.log('💵 Final Worker Balance (after withdrawal approval):', walletData.balance);

    if (walletData.balance !== 2000) {
      throw new Error(`Expected final balance to be 2000, got ${walletData.balance}`);
    }

    console.log('🎉 End-to-end payment and withdrawal test passed successfully!');

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

main();
