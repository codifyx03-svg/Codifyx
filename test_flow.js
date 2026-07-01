// test_flow.js – end-to-end API test for Codify platform
// Run with: node test_flow.js

const fetch = require('node-fetch');
const base = 'http://localhost:3000';

async function main() {
  console.log('--- Starting automated workflow test ---');

  const projectTitle = 'Test E‑Commerce Site';
  const projectDescription = 'Simple shop with payment gateway';

  // Cleanup old test data so the test is repeatable
  const sqlite3 = require('sqlite3').verbose();
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./database.db', (err) => {
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
  tokens.admin = await login('koushishetty8109@gmail.com', 'Admin@123');
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

  // 6️⃣ Fetch available tasks – should contain small & big sections
  const tasks = await fetchAvailableTasks(tokens.worker);
  console.log('Available tasks:', JSON.stringify(tasks, null, 2));

  const bigProjects = tasks.big || tasks.big_projects || [];
  // 7️⃣ Claim a big task from the newly created project to test lock
  const bigTask = bigProjects.find(t => t.project_id === projectId || t.id === projectId);
  if (!bigTask) throw new Error('No big task available for claim test on the new project');
  console.log('First claim (worker)');
  await claimTask(tokens.worker, bigTask.id);

  // create three extra workers and claim the same task
  for (let i = 1; i <= 3; i++) {
    const email = `extra${i}@example.com`;
    await registerAndApproveWorker(tokens.admin, email, `Extra${i}`, 'Password1!');
    const token = await login(email, 'Password1!');
    console.log(`Claim by ${email}`);
    await claimTask(token, bigTask.id);
  }

  // fourth claim should have locked the task – next claim must fail
  console.log('Attempt extra claim after lock (expected failure)');
  try {
    await claimTask(tokens.worker, bigTask.id);
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
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error('Register error: ' + (json.error || 'unknown'));
  return json;
}

async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Login error');
  return json.token;
}

async function verify(email, code) {
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Verification error');
  console.log(`Verified ${email}`);
}

async function submitProject(token, data) {
  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!json.success) throw new Error('Project submission failed');
  return json.projectId;
}

async function adminReviseBudget(token, projectId, newBudget) {
  const res = await fetch(`${base}/api/admin/projects/${projectId}/request-revision`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Requesting budget revision', requestedBudget: newBudget })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Admin revise budget failed: ' + (json.error || 'unknown'));
}

async function clientAccept(token, projectId, accept) {
  const res = await fetch(`${base}/api/projects/${projectId}/accept`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accept })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Client accept/reject failed');
}

async function fetchAvailableTasks(token) {
  const res = await fetch(`${base}/api/tasks/available`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Fetching tasks failed');
  return json;
}

async function claimTask(token, taskId) {
  const res = await fetch(`${base}/api/tasks/${taskId}/claim`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Claim failed: ' + (json.error || 'unknown'));
  return json;
}

async function getPendingWorkerId(adminToken, email) {
  const res = await fetch(`${base}/api/admin/workers/pending`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Failed to get pending workers');
  const w = json.workers.find(item => item.email === email);
  if (!w) throw new Error('Worker not found in pending list: ' + email);
  return w.id;
}

async function adminApproveWorker(adminToken, workerId) {
  const res = await fetch(`${base}/api/admin/workers/${workerId}/approve`, {
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
