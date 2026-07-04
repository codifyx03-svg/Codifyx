// test_flow.js – end-to-end API test for Codify platform
// Run with: node test_flow.js

const fetch = require('node-fetch');
const path = require('path');
const publicBase = 'http://localhost:3003';
const adminBase = 'http://localhost:3004';

async function main() {
  console.log('--- Starting automated workflow test ---');

  const projectTitle = 'Test E‑Commerce Site';
  const projectDescription = 'Simple shop with payment gateway';

  // Cleanup old test data so the test is repeatable
  const sqlite3 = require('sqlite3').verbose();
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(__dirname, '..', 'database.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        const testEmails = ['client@example.com', 'worker@example.com', 'extra1@example.com', 'extra2@example.com', 'extra3@example.com'];
        const emailPlaceholders = testEmails.map(() => '?').join(',');
        
        const statements = [
          // Delete groups and tasks for projects created by test users
          { sql: `DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))))`, params: testEmails },
          { sql: `DELETE FROM groups WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders})))`, params: testEmails },
          { sql: `DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders})))`, params: testEmails },
          { sql: `DELETE FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))`, params: testEmails },
          // Delete test users
          { sql: `DELETE FROM users WHERE email IN (${emailPlaceholders})`, params: testEmails }
        ];

        let index = 0;
        const runNext = () => {
          if (index >= statements.length) {
            db.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
            return;
          }
          const stmt = statements[index++];
          db.run(stmt.sql, stmt.params, (runErr) => {
            if (runErr) return reject(runErr);
            runNext();
          });
        };
        runNext();
      });
    });
  });

  const tokens = {};
  const users = {};
  // Direct login for seeded admin using provided credentials
  tokens.admin = await login('koushishetty8109@gmail.com', '@Koushi2005', true);
  // Register client and worker as before
  const clientReg = await register('client@example.com', 'ClientUser', 'client', 'Password1!');
  await verify('client@example.com', clientReg.verificationCode);
  users.client = clientReg;
  const workerReg = await registerAndApproveWorker(tokens.admin, 'worker@example.com', 'WorkerUser', 'Password1!');
  users.worker = workerReg;

  // 2️⃣ Login each role
  // tokens.admin already set above
  tokens.client = await login('client@example.com', 'Password1!');
  tokens.worker = await login('worker@example.com', 'Password1!');

  // 3️⃣ Client submits a project
  const projectId = await submitProject(tokens.client, {
    title: 'Test E‑Commerce Site',
    description: 'Simple shop with payment gateway',
    budget: 30000,
    deadline: '2026-12-31',
    technologies: ''
  });

  // 4️⃣ Admin revises budget (low)
  await adminReviseBudget(tokens.admin, projectId, 20000);

  // 5️⃣ Client accepts revised budget
  await clientAccept(tokens.client, projectId, true);

  // Register 3 extra workers first so they can form a team
  const extraTokens = [];
  for (let i = 1; i <= 3; i++) {
    const email = `extra${i}@example.com`;
    await registerAndApproveWorker(tokens.admin, email, `Extra${i}`, 'Password1!');
    const token = await login(email, 'Password1!');
    extraTokens.push(token);
  }

  // Express interest by all 4 workers to form the team for the big project
  console.log('Forming team for big project...');
  await expressInterest(tokens.worker, projectId);
  for (const token of extraTokens) {
    await expressInterest(token, projectId);
  }

  // 6️⃣ Fetch available tasks – should contain small & big sections
  const tasks = await fetchAvailableTasks(tokens.worker);
  console.log('Available tasks:', JSON.stringify(tasks, null, 2));

  const bigProjects = tasks.big_projects || [];
  // Find the project tasks. Since team is formed, we can see tasks inside our project
  const projectObj = bigProjects.find(p => p.id === projectId);
  if (!projectObj || !projectObj.available_tasks || projectObj.available_tasks.length === 0) {
    throw new Error('No tasks available for claim test on the new project');
  }
  const taskToClaim = projectObj.available_tasks[0];

  console.log('First claim (worker)');
  await claimTask(tokens.worker, taskToClaim.id);

  // Next claim on the same task by another worker should fail
  console.log('Attempt extra claim on already claimed task (expected failure)');
  try {
    await claimTask(extraTokens[0], taskToClaim.id);
    throw new Error('Claim should have failed but succeeded');
  } catch (e) {
    console.log('Correctly failed:', e.message);
  }

  console.log('--- Workflow test completed ---');
}

async function register(email, name, role, password, withResume = false) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('role', role);
  form.append('email', email);
  form.append('name', name);
  form.append('password', password);
  if (withResume) {
    const dummy = Buffer.from('resume content');
    form.append('resume', dummy, { filename: 'resume.txt' });
  }
  const res = await fetch(`${publicBase}/api/auth/register`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error('Register error: ' + (json.error || 'unknown'));

  // Retrieve verification code from database for local testing flow
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(path.join(__dirname, '..', 'database.db'));
  const user = await new Promise((resolve, reject) => {
    db.get('SELECT verification_code FROM users WHERE email = ?', [email], (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
  if (user) {
    json.verificationCode = user.verification_code;
  }

  return json;
}

async function login(email, password, isAdmin = false) {
  if (isAdmin) {
    const res = await fetch(`${adminBase}/api/admin/auth/portal-secure-login-x97`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!json.success) throw new Error('Admin login failed: ' + (json.error || 'unknown'));
    return json.token;
  } else {
    const res = await fetch(`${publicBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!json.success) throw new Error('Login error: ' + (json.error || 'unknown'));
    return json.token;
  }
}

async function verify(email, code) {
  const res = await fetch(`${publicBase}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Verification error');
  console.log(`Verified ${email}`);
}

async function submitProject(token, data) {
  const res = await fetch(`${publicBase}/api/projects`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!json.success) throw new Error('Project submission failed');
  return json.projectId;
}

async function adminReviseBudget(token, projectId, newBudget) {
  const res = await fetch(`${adminBase}/api/admin/projects/${projectId}/request-revision`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Requesting budget revision', requestedBudget: newBudget })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Admin revise budget failed: ' + (json.error || 'unknown'));
}

async function clientAccept(token, projectId, accept) {
  const res = await fetch(`${publicBase}/api/projects/${projectId}/accept`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accept })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Client accept/reject failed');
}

async function fetchAvailableTasks(token) {
  const res = await fetch(`${publicBase}/api/tasks/available`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Fetching tasks failed');
  return json;
}

async function claimTask(token, taskId) {
  const res = await fetch(`${publicBase}/api/tasks/${taskId}/claim`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Claim failed: ' + (json.error || 'unknown'));
  return json;
}

async function expressInterest(token, projectId) {
  const res = await fetch(`${publicBase}/api/projects/${projectId}/express-interest`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Express interest failed: ' + (json.error || 'unknown'));
  return json;
}

async function getPendingWorkerId(adminToken, email) {
  const res = await fetch(`${adminBase}/api/admin/workers/pending`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Failed to get pending workers: ' + JSON.stringify(json));
  const w = json.workers.find(item => item.email === email);
  if (!w) throw new Error('Worker not found in pending list: ' + email);
  return w.id;
}

async function adminApproveWorker(adminToken, workerId) {
  const res = await fetch(`${adminBase}/api/admin/workers/${workerId}/approve`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve' })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Worker approval failed: ' + (json.error || 'unknown'));
}

async function registerAndApproveWorker(adminToken, email, name, password) {
  const reg = await register(email, name, 'worker', password, true);
  await verify(email, reg.verificationCode);
  const workerId = await getPendingWorkerId(adminToken, email);
  await adminApproveWorker(adminToken, workerId);
  return reg;
}

main().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
