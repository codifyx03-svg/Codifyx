// tests/workflow/test_worker_invitation.js
// Run with: node tests/workflow/test_worker_invitation.js

const fetch = require('node-fetch');
const path = require('path');
const database = require('../../shared/database/database');

const publicBase = 'http://localhost:3003';
const adminBase = 'http://localhost:3004';

async function login(email, password, isAdmin = false) {
  const url = isAdmin 
    ? `${adminBase}/api/admin/auth/portal-secure-login-x97` 
    : `${publicBase}/api/auth/login`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Login failed');
  }
  return json.token;
}

async function assertFails(promise, expectedErrorMsg) {
  try {
    await promise;
    throw new Error('Expected operation to fail, but it succeeded.');
  } catch (err) {
    if (expectedErrorMsg && !err.message.includes(expectedErrorMsg)) {
      throw new Error(`Expected error containing "${expectedErrorMsg}", but got: "${err.message}"`);
    }
    console.log(`✅ Correctly rejected with expected error: "${err.message}"`);
  }
}

async function main() {
  console.log('--- Starting worker invitation system tests ---');

  const testEmail = 'invited_worker@example.com';
  const testName = 'Invited Test Worker';

  // 0. Clean up any previous test run data
  console.log('0️⃣ Cleaning up database...');
  await database.run('DELETE FROM group_members WHERE worker_id IN (SELECT id FROM users WHERE email = ?)', [testEmail]);
  await database.run('DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [testEmail]);
  await database.run('DELETE FROM users WHERE email = ?', [testEmail]);

  // 1. Log in as admin
  console.log('1️⃣ Logging in as Admin...');
  const adminToken = await login('koushishetty8109@gmail.com', '@Koushi2005', true);
  console.log('✅ Admin logged in successfully.');

  // 2. Admin creates worker invitation
  console.log('2️⃣ Inviting worker...');
  const inviteRes = await fetch(`${adminBase}/api/admin/workers`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ name: testName, email: testEmail })
  });
  const inviteJson = await inviteRes.json();
  
  if (!inviteRes.ok) {
    throw new Error('Failed to invite worker: ' + inviteJson.error);
  }
  
  const workerId = inviteJson.workerId;
  const rawToken = inviteJson.token;
  console.log(`✅ Worker invited. ID: ${workerId}, Raw Token: ${rawToken}`);

  // 3. Verify database state for invited worker
  console.log('3️⃣ Verifying database states...');
  const dbUser = await database.get('SELECT * FROM users WHERE id = ?', [workerId]);
  if (dbUser.invitation_status !== 'Pending Invitation') throw new Error('Incorrect invitation status: ' + dbUser.invitation_status);
  if (dbUser.approved !== 0) throw new Error('Worker should not be approved yet');
  if (dbUser.verified !== 0) throw new Error('Worker should not be verified yet');
  if (!dbUser.invitation_token) throw new Error('Invitation token should not be null');
  if (!dbUser.invitation_expiry) throw new Error('Invitation expiry should not be null');
  
  const dbWallet = await database.get('SELECT * FROM wallets WHERE user_id = ?', [workerId]);
  if (!dbWallet) throw new Error('Wallet not created for invited worker');
  console.log('✅ Database checks passed.');

  // 4. Verify login fails for pending worker
  console.log('4️⃣ Verifying login block for unactivated worker...');
  await assertFails(
    login(testEmail, 'somepassword'),
    'Your account is pending invitation activation'
  );

  // 5. Verify invalid token is rejected
  console.log('5️⃣ Verifying invalid token verification rejection...');
  const verifyInvalidRes = await fetch(`${publicBase}/api/auth/invitation/verify?token=invalid_token`);
  if (verifyInvalidRes.ok) throw new Error('Invalid token should have been rejected');
  const verifyInvalidJson = await verifyInvalidRes.json();
  console.log('✅ Invalid token rejected correctly:', verifyInvalidJson.error);

  // 6. Verify valid token can be verified
  console.log('6️⃣ Verifying valid token...');
  const verifyValidRes = await fetch(`${publicBase}/api/auth/invitation/verify?token=${rawToken}`);
  if (!verifyValidRes.ok) {
    const verifyValidJson = await verifyValidRes.json();
    throw new Error('Valid token verification failed: ' + verifyValidJson.error);
  }
  const verifyValidJson = await verifyValidRes.json();
  if (verifyValidJson.email !== testEmail) throw new Error('Returned email does not match');
  console.log('✅ Valid token verified successfully.');

  // 7. Verify activation token cannot be bypassed with weak password or missing fields
  console.log('7️⃣ Verifying activation validation constraints...');
  const activateWeakRes = await fetch(`${publicBase}/api/auth/invitation/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: rawToken,
      phone: '+91 99887 76655',
      skills: 'React',
      experience: '3 years',
      password: 'weak',
      confirm_password: 'weak'
    })
  });
  const activateWeakJson = await activateWeakRes.json();
  if (activateWeakRes.ok || (!activateWeakJson.error.includes('Password') && !activateWeakJson.error.includes('Invalid value'))) {
    throw new Error('Weak password should be rejected');
  }
  console.log('✅ Weak password rejected correctly.');

  // 8. Activate the worker account successfully
  console.log('8️⃣ Activating worker account...');
  const activateRes = await fetch(`${publicBase}/api/auth/invitation/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: rawToken,
      phone: '+91 99887 76655',
      skills: 'React, Node.js, SQLite',
      experience: '3 years of experience',
      bio: 'Ready to build awesome applications',
      portfolio_url: 'https://github.com/invitedworker',
      password: 'Password1!',
      confirm_password: 'Password1!'
    })
  });
  const activateJson = await activateRes.json();
  if (!activateRes.ok) {
    throw new Error('Worker activation failed: ' + activateJson.error);
  }
  console.log('✅ Worker account activated successfully.');

  // 9. Verify token is deleted and state is Active in database
  console.log('9️⃣ Verifying database states post-activation...');
  const dbUserPost = await database.get('SELECT * FROM users WHERE id = ?', [workerId]);
  if (dbUserPost.invitation_status !== 'Active') throw new Error('Incorrect status post-activation: ' + dbUserPost.invitation_status);
  if (dbUserPost.approved !== 1) throw new Error('Worker should be approved now');
  if (dbUserPost.verified !== 1) throw new Error('Worker should be verified now');
  if (dbUserPost.invitation_token !== null) throw new Error('Token should be deleted');
  if (dbUserPost.phone !== '+91 99887 76655') throw new Error('Phone mismatch');
  if (dbUserPost.portfolio_url !== 'https://github.com/invitedworker') throw new Error('Portfolio URL mismatch');
  if (dbUserPost.bio !== 'Ready to build awesome applications') throw new Error('Bio mismatch');
  if (dbUserPost.experience_years !== 3) throw new Error('Experience years parsed incorrectly: ' + dbUserPost.experience_years);
  console.log('✅ Database checks post-activation passed.');

  // 10. Verify activation token cannot be reused
  console.log('10️⃣ Verifying token reuse prevention...');
  const reuseRes = await fetch(`${publicBase}/api/auth/invitation/verify?token=${rawToken}`);
  if (reuseRes.ok) throw new Error('Reusing the token should have failed');
  console.log('✅ Token reuse prevented successfully.');

  // 11. Worker logs in successfully
  console.log('11️⃣ Logging in as activated worker...');
  const workerToken = await login(testEmail, 'Password1!');
  console.log('✅ Worker logged in successfully.');

  // 12. Verify worker has restricted access (cannot call admin API)
  console.log('12️⃣ Verifying role-based access control (RBAC)...');
  const rbacRes = await fetch(`${adminBase}/api/admin/workers/pending`, {
    headers: { 'Authorization': `Bearer ${workerToken}` }
  });
  if (rbacRes.status !== 401 && rbacRes.status !== 403) {
    throw new Error('Worker should be rejected from Admin endpoints with 401/403, but got status: ' + rbacRes.status);
  }
  console.log('✅ Worker correctly blocked from Admin dashboard (401/403).');

  // 13. Test Suspend Worker
  console.log('13️⃣ Suspending worker via Admin...');
  const suspendRes = await fetch(`${adminBase}/api/admin/workers/${workerId}/suspend`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  });
  if (!suspendRes.ok) throw new Error('Failed to suspend worker');
  
  // Verify suspend status in DB
  const dbUserSuspended = await database.get('SELECT approved, invitation_status FROM users WHERE id = ?', [workerId]);
  if (dbUserSuspended.approved !== 0) throw new Error('Suspended worker should be unapproved');
  if (dbUserSuspended.invitation_status !== 'Suspended') throw new Error('Incorrect status: ' + dbUserSuspended.invitation_status);
  
  // Verify worker cannot log in
  await assertFails(
    login(testEmail, 'Password1!'),
    'Your account has been suspended by an administrator'
  );
  console.log('✅ Worker suspended and login blocked successfully.');

  // 14. Test Reactivate Worker
  console.log('14️⃣ Reactivating worker via Admin...');
  const reactivateRes = await fetch(`${adminBase}/api/admin/workers/${workerId}/reactivate`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  });
  if (!reactivateRes.ok) throw new Error('Failed to reactivate worker');
  
  // Verify reactivate status in DB
  const dbUserReactivated = await database.get('SELECT approved, invitation_status FROM users WHERE id = ?', [workerId]);
  if (dbUserReactivated.approved !== 1) throw new Error('Reactivated worker should be approved');
  if (dbUserReactivated.invitation_status !== 'Active') throw new Error('Incorrect status: ' + dbUserReactivated.invitation_status);
  
  // Verify worker can log in again
  const workerToken2 = await login(testEmail, 'Password1!');
  if (!workerToken2) throw new Error('Failed to log in after reactivation');
  console.log('✅ Worker reactivated and login restored successfully.');

  // 15. Test Cancel Invitation
  console.log('15️⃣ Testing invitation cancellation...');
  // Create a new invitation to cancel
  const cancelTestEmail = 'cancel_test@example.com';
  await database.run('DELETE FROM users WHERE email = ?', [cancelTestEmail]);
  
  const inviteCancelRes = await fetch(`${adminBase}/api/admin/workers`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ name: 'Cancel Test', email: cancelTestEmail })
  });
  const inviteCancelJson = await inviteCancelRes.json();
  const cancelWorkerId = inviteCancelJson.workerId;
  const cancelToken = inviteCancelJson.token;

  // Cancel it
  const cancelRes = await fetch(`${adminBase}/api/admin/workers/${cancelWorkerId}/cancel-invite`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  });
  if (!cancelRes.ok) throw new Error('Failed to cancel invitation');

  // Verify status is Inactive and token is null
  const dbUserCancelled = await database.get('SELECT invitation_token, invitation_status FROM users WHERE id = ?', [cancelWorkerId]);
  if (dbUserCancelled.invitation_status !== 'Inactive') throw new Error('Incorrect status: ' + dbUserCancelled.invitation_status);
  if (dbUserCancelled.invitation_token !== null) throw new Error('Token should be null after cancellation');

  // Verify token cannot be verified
  const verifyCancelRes = await fetch(`${publicBase}/api/auth/invitation/verify?token=${cancelToken}`);
  if (verifyCancelRes.ok) throw new Error('Cancelled token should not be verifiable');
  console.log('✅ Cancellation tested successfully.');

  // 16. Test Resend Invitation
  console.log('16️⃣ Testing invitation resending...');
  const resendRes = await fetch(`${adminBase}/api/admin/workers/${cancelWorkerId}/resend-invite`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  });
  if (!resendRes.ok) throw new Error('Failed to resend invitation');
  const resendJson = await resendRes.json();
  const newRawToken = resendJson.token;

  // Verify status is Pending Invitation again
  const dbUserResent = await database.get('SELECT invitation_token, invitation_status FROM users WHERE id = ?', [cancelWorkerId]);
  if (dbUserResent.invitation_status !== 'Pending Invitation') throw new Error('Incorrect status after resend: ' + dbUserResent.invitation_status);
  if (!dbUserResent.invitation_token) throw new Error('Token should not be null after resend');

  // Verify new token works
  const verifyResentRes = await fetch(`${publicBase}/api/auth/invitation/verify?token=${newRawToken}`);
  if (!verifyResentRes.ok) throw new Error('Resent token should be verifiable');
  console.log('✅ Resending tested successfully.');

  // Clean up cancel test user
  await database.run('DELETE FROM wallets WHERE user_id = ?', [cancelWorkerId]);
  await database.run('DELETE FROM users WHERE id = ?', [cancelWorkerId]);

  console.log('\n🌟 ALL WORKER INVITATION FLOW TESTS PASSED SUCCESSFULLY! 🌟\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Test execution failed with error:', err);
  process.exit(1);
});
