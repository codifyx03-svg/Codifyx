// test_team_flow.js – test team management feature for big projects
// Run with: node test_team_flow.js

const fetch = require('node-fetch');
const path = require('path');
const publicBase = 'http://localhost:3003';
const adminBase = 'http://localhost:3004';

async function main() {
  console.log('--- Starting team management workflow test ---\n');

  // Clean up any leftover test data
  const sqlite3 = require('sqlite3').verbose();
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'database.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        const testEmails = ['worker1@example.com', 'worker2@example.com', 'worker3@example.com', 'worker4@example.com', 'worker5@example.com', 'client@example.com'];
        const emailPlaceholders = testEmails.map(() => '?').join(',');

        const statements = [
          { sql: `DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))))`, params: testEmails },
          { sql: `DELETE FROM group_invites WHERE group_id IN (SELECT id FROM groups WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))))`, params: testEmails },
          { sql: `DELETE FROM groups WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders})))`, params: testEmails },
          { sql: `DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders})))`, params: testEmails },
          { sql: `DELETE FROM project_interest WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders})))`, params: testEmails },
          { sql: `DELETE FROM projects WHERE client_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))`, params: testEmails },
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
  
  // 1️⃣ Login admin
  tokens.admin = await login('koushishetty8109@gmail.com', '@Koushi2005', true);
  console.log('✓ Admin logged in');

  // 2️⃣ Register 5 workers (4 for team + 1 extra) via admin creation
  const workerEmails = ['worker1@example.com', 'worker2@example.com', 'worker3@example.com', 'worker4@example.com', 'worker5@example.com'];
  for (const email of workerEmails) {
    const res = await fetch(`${adminBase}/api/admin/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.admin}`
      },
      body: JSON.stringify({
        name: email.split('@')[0],
        email: email,
        password: 'Password1!',
        skills: 'React, Node.js',
        experience: '3 years',
        available_hours: 40,
        approved: 1
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Admin worker creation failed');
    tokens[email] = await login(email, 'Password1!');
  }
  console.log(`✓ ${workerEmails.length} workers registered and approved via admin\n`);

  // 3️⃣ Register a client
  const clientReg = await register('client@example.com', 'ClientUser', 'client', 'Password1!');
  await verify('client@example.com', clientReg.verificationCode);
  tokens.client = await login('client@example.com', 'Password1!');
  console.log('✓ Client registered and verified');

  // 4️⃣ Client submits a BIG project
  const projectId = await submitProject(tokens.client, {
    title: 'Team Collaboration Project',
    description: 'A large-scale project requiring team effort',
    budget: 50000,
    deadline: '2026-12-31',
    technologies: 'React, Node.js'
  });
  console.log(`✓ Project created (ID: ${projectId})\n`);

  // 5️⃣ Admin revises budget
  try {
    await adminReviseBudget(tokens.admin, projectId, 45000);
    console.log('✓ Admin revised budget');
  } catch (err) {
    console.log(`❌ Budget revision error: ${err.message}`);
    process.exit(1);
  }

  // 6️⃣ Client accepts revised budget
  await clientAccept(tokens.client, projectId, true);
  console.log('✓ Client accepted, tasks auto-generated\n');

  // 7️⃣ First 4 workers express interest
  const projectUrl = `${publicBase}/api/projects/${projectId}`;
  const projectData = await (await fetch(projectUrl, { headers: { 'Authorization': `Bearer ${tokens.admin}` } })).json();
  console.log('Project details:', projectData);

  console.log('\n--- Workers Expressing Interest ---');
  for (let i = 0; i < 4; i++) {
    const workerEmail = workerEmails[i];
    console.log(`\nWorker ${i + 1} (${workerEmail}) expressing interest...`);
    const response = await fetch(`${publicBase}/api/projects/${projectId}/express-interest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokens[workerEmail]}` }
    });
    const data = await response.json();
    console.log(`→ Response: ${data.message}`);
    
    if (i === 3) {
      const message = data.message || '';
      if (message.includes('Team formed')) {
        console.log('\n✅ TEAM AUTOMATICALLY FORMED AFTER 4TH WORKER!');
      }
    }
  }

  // 8️⃣ Check group was created
  console.log('\n--- Verifying Team Creation ---');
  const groupsResponse = await fetch(`${publicBase}/api/worker/groups`, {
    headers: { 'Authorization': `Bearer ${tokens.admin}` }
  });
  const groupsData = await groupsResponse.json();
  if (!groupsData.success) throw new Error('Failed to fetch groups: ' + JSON.stringify(groupsData));
  const projectGroup = groupsData.groups.find(g => g.project_id === projectId);
  if (projectGroup) {
    console.log(`✓ Group created (ID: ${projectGroup.id})`);
    console.log(`  - Leader: ${projectGroup.leader_id}`);
    console.log(`  - Project: ${projectGroup.project_id}`);
  }

  // 9️⃣ Verify project status changed to team-assigned
  const projectCheck = await fetch(`${adminBase}/api/admin/projects`, {
    headers: { 'Authorization': `Bearer ${tokens.admin}` }
  });
  const projectsData = await projectCheck.json();
  const updatedProject = projectsData.projects.find(p => p.id === projectId);
  console.log(`✓ Project status: ${updatedProject.status}`);

  // 🔟 5th worker tries to express interest (should fail)
  console.log('\n--- Attempting 5th Worker Interest (Should Fail) ---');
  const response = await fetch(`${publicBase}/api/projects/${projectId}/express-interest`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokens[workerEmails[4]]}` }
  });
  const data = await response.json();
  if (!response.ok) {
    console.log(`✓ Correctly blocked: ${data.error}`);
  } else {
    console.error(`❌ 5th worker interest unexpectedly succeeded: ${JSON.stringify(data)}`);
    throw new Error('5th worker interest should not be accepted after team formation');
  }

  console.log('\n--- Team Management Test Completed ---');
}

async function register(email, name, role, password) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('role', role);
  form.append('email', email);
  form.append('name', name);
  form.append('password', password);
  form.append('accepted_legal', 'true');
  
  // Workers require resume
  if (role === 'worker') {
    form.append('resume', Buffer.from('Sample resume content'), { filename: 'resume.txt' });
  }
  
  const res = await fetch(`${publicBase}/api/auth/register`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error('Register error: ' + (json.error || 'unknown'));

  // Retrieve verification code from database for local testing flow
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'database.db'));
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
  if (!json.success) throw new Error('Verify error: ' + (json.error || 'unknown'));
}

async function approveWorker(adminToken, email) {
  const workersRes = await fetch(`${adminBase}/api/admin/workers/pending`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const workersData = await workersRes.json();
  const worker = workersData.workers.find(w => w.email === email);
  if (!worker) throw new Error(`Worker ${email} not found`);

  const res = await fetch(`${adminBase}/api/admin/workers/${worker.id}/approve`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const json = await res.json();
  if (!json.success) throw new Error('Worker approval failed');
}

async function submitProject(clientToken, projectData) {
  const res = await fetch(`${publicBase}/api/projects`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${clientToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData)
  });
  const json = await res.json();
  if (!json.success) {
    console.log('Project submission response:', JSON.stringify(json, null, 2));
    throw new Error('Project submission failed: ' + (json.error || 'unknown'));
  }
  return json.projectId;
}

async function adminReviseBudget(adminToken, projectId, newBudget) {
  const res = await fetch(`${adminBase}/api/admin/projects/${projectId}/request-revision`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedBudget: newBudget, message: 'Revision requested for better resource allocation' })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Budget revision failed: ' + (json.error || 'unknown'));
}

async function clientAccept(clientToken, projectId, accept) {
  const res = await fetch(`${publicBase}/api/projects/${projectId}/accept`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${clientToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accept })
  });
  const json = await res.json();
  if (!json.success) throw new Error('Client accept failed: ' + (json.error || 'unknown'));
}

main().catch(console.error);
