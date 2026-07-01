// Test OAuth and OTP Authentication Endpoints
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();

const BASE_URL = 'http://localhost:3000';

async function cleanupTestUsers() {
  const emailList = ['otp-client@example.com', 'otp-worker@example.com'];
  const placeholders = emailList.map(() => '?').join(',');
  const db = new sqlite3.Database('./database.db');

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`DELETE FROM otp_sessions WHERE email IN (${placeholders})`, emailList, (err) => {
        if (err) return reject(err);
        db.run(`DELETE FROM users WHERE email IN (${placeholders})`, emailList, (err2) => {
          db.close();
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  });
}

async function test(name, fn) {
  try {
    console.log(`\n✓ Testing: ${name}`);
    await fn();
  } catch (err) {
    console.error(`✗ Error in ${name}:`, err.message);
  }
}

(async () => {
  console.log('=== OAuth & OTP Authentication Tests ===\n');
  await cleanupTestUsers();

  // Test 1: Request Email OTP for new client signup
  let otpCode = '';
  await test('Email OTP Request - New Client', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-client@example.com',
        role: 'client'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  [Testing OTP Code]: ${data.debug_otp}`);
    otpCode = data.debug_otp;
  });

  // Test 2: Verify Email OTP and create account
  await test('Email OTP Verify - Complete Client Registration', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-client@example.com',
        otp: otpCode,
        role: 'client',
        name: 'OTP Client User',
        company_name: 'OTP Test Co',
        phone: '+91 99999 88888'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  User: ${data.user.name} (${data.user.email})`);
    console.log(`  Token Received: ${data.token ? 'YES' : 'NO'}`);
  });

  // Test 3: Request Email OTP for new worker signup
  let workerOtpCode = '';
  await test('Email OTP Request - New Worker', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-worker@example.com',
        role: 'worker'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  [Testing OTP Code]: ${data.debug_otp}`);
    workerOtpCode = data.debug_otp;
  });

  // Test 4: Verify Email OTP and create worker account
  await test('Email OTP Verify - Complete Worker Registration', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-worker@example.com',
        otp: workerOtpCode,
        role: 'worker',
        name: 'OTP Worker User',
        age: 28,
        skills: 'React, Node.js, SQL',
        experience: '3 years in web development',
        available_hours: 20
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  User: ${data.user.name} (${data.user.email})`);
    console.log(`  Note: Worker account pending admin approval`);
  });

  // Test 5: Request Login OTP for existing client
  let loginOtpCode = '';
  await test('Email OTP Login - Request OTP', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-client@example.com',
        role: 'client'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  [Testing OTP Code]: ${data.debug_otp}`);
    loginOtpCode = data.debug_otp;
  });

  // Test 6: Verify Login OTP
  await test('Email OTP Login - Verify OTP & Get Token', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-client@example.com',
        otp: loginOtpCode,
        role: 'client'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    console.log(`  Message: ${data.message}`);
    console.log(`  User: ${data.user.name} (${data.user.email})`);
    console.log(`  Token Received: ${data.token ? 'YES' : 'NO'}`);
  });

  // Test 7: Test invalid OTP
  await test('Email OTP - Invalid Code Test', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/email-otp/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'otp-client@example.com',
        otp: '000000',
        role: 'client'
      })
    });
    const data = await res.json();
    if (res.ok) throw new Error('Should have failed with invalid OTP');
    console.log(`  Correctly rejected: ${data.error}`);
  });

  // Test 8: Google OAuth Start endpoint
  await test('Google OAuth - Start Flow', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google/start?role=worker`, {
      method: 'GET',
      redirect: 'manual'
    });
    console.log(`  Status: ${res.status}`);
    if (res.status === 307 || res.status === 302) {
      const location = res.headers.get('location');
      console.log(`  Redirects to: ${location?.substring(0, 80)}...`);
    } else if (res.status === 400) {
      const data = await res.json();
      console.log(`  [Info]: ${data.error} (Google OAuth not configured)`);
    }
  });

  console.log('\n=== All Tests Completed ===\n');
  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
