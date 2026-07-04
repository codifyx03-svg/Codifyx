const fetch = require('node-fetch');
const adminBase = 'http://localhost:3004';

async function runSecurityTests() {
  console.log('🔒 Starting Secure Admin System Security Verification...\n');

  try {
    // Test 1: IP Whitelisting Validation
    console.log('⚡ Test 1: IP Whitelisting...');
    // We send a request with a spoofed external IP address in X-Forwarded-For
    const ipRes = await fetch(`${adminBase}/api/admin/auth/portal-secure-login-x97`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.42'
      },
      body: JSON.stringify({ email: 'super_admin@company.com', password: 'wrong' })
    });
    
    if (ipRes.status === 403) {
      console.log('✅ Success: Access denied for non-whitelisted IP (status 403).');
    } else {
      throw new Error(`IP Whitelist failed: expected status 403, got ${ipRes.status}`);
    }

    // Test 2: Account Lockout after 3 failures
    console.log('\n⚡ Test 2: Account Lockout...');
    const testEmail = 'finance_admin@company.com';
    
    // We make 4 attempts with invalid passwords
    for (let i = 1; i <= 4; i++) {
      const lockRes = await fetch(`${adminBase}/api/admin/auth/portal-secure-login-x97`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: 'wrongpassword' })
      });
      const lockJson = await lockRes.json();
      console.log(`   Attempt ${i} response:`, lockRes.status, lockJson.error || 'OK');
      
      if (i === 4) {
        if (lockRes.status === 403 && lockJson.error.includes('locked')) {
          console.log('✅ Success: Account locked on 4th attempt (subsequent to 3 failures).');
        } else {
          throw new Error('Account lockout failed: expected account locked message (status 403), got status ' + lockRes.status);
        }
      }
    }

    // Test 3: Admin Role-Based Access Control (RBAC) Verification
    console.log('\n⚡ Test 3: Role-Based Access Control (RBAC)...');
    
    // Log in as Project Admin
    console.log('   Logging in as Project Admin...');
    const projToken = await adminLogin('project_admin@company.com', 'projectadmin123');
    
    // Log in as Finance Admin
    console.log('   Logging in as Finance Admin...');
    const finToken = await adminLogin('finance_admin@company.com', 'financeadmin123'); // reset lockout first

    // Project Admin attempts to access a Finance route (approve-payment)
    console.log('   Project Admin accessing Finance endpoint /api/admin/tasks/1/approve-payment...');
    const accessRes1 = await fetch(`${adminBase}/api/admin/tasks/1/approve-payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${projToken}` }
    });
    const accessJson1 = await accessRes1.json();
    if (accessRes1.status === 403) {
      console.log('   ✅ Success: Project Admin blocked from Finance route (status 403).');
    } else {
      throw new Error(`RBAC failed: Project Admin was not blocked, got status ${accessRes1.status}`);
    }

    // Finance Admin attempts to access a Project route (approve worker)
    console.log('   Finance Admin accessing Project endpoint /api/admin/workers/1/approve...');
    const accessRes2 = await fetch(`${adminBase}/api/admin/workers/1/approve`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${finToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'approve' })
    });
    if (accessRes2.status === 403) {
      console.log('   ✅ Success: Finance Admin blocked from Project route (status 403).');
    } else {
      throw new Error(`RBAC failed: Finance Admin was not blocked, got status ${accessRes2.status}`);
    }

    // Test 4: Single Session Enforcement (Token Invalidation)
    console.log('\n⚡ Test 4: Single Session Enforcement...');
    console.log('   Logging in as Super Admin (Session 1)...');
    const token1 = await adminLogin('super_admin@company.com', 'superadmin123');

    console.log('   Logging in as Super Admin (Session 2)...');
    const token2 = await adminLogin('super_admin@company.com', 'superadmin123');

    // Test if Session 1 is terminated
    console.log('   Verifying Session 1 token against /api/admin/projects...');
    const sessionRes1 = await fetch(`${adminBase}/api/admin/projects`, {
      headers: { 'Authorization': `Bearer ${token1}` }
    });
    if (sessionRes1.status === 403) {
      console.log('   ✅ Success: Session 1 token terminated on Session 2 login.');
    } else {
      throw new Error(`Session enforcement failed: Session 1 is still active (status ${sessionRes1.status})`);
    }

    console.log('\n🌟 ALL ADMINISTRATIVE SECURITY VERIFICATIONS COMPLETED SUCCESSFULLY!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Security verification failed:', error.message);
    process.exit(1);
  }
}

async function adminLogin(email, password) {
  // Reset lockout from database if checking seeded admins
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const db = new sqlite3.Database(path.join(__dirname, '..', 'database.db'));
  await new Promise((resolve) => {
    db.run('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE email = ?', [email], () => {
      db.close(resolve);
    });
  });

  const res = await fetch(`${adminBase}/api/admin/auth/portal-secure-login-x97`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Login failed for ${email}: ` + (json.error || 'unknown'));
  }
  return json.token;
}

runSecurityTests();
