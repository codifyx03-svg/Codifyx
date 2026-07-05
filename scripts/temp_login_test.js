const fetch = require('node-fetch');
(async () => {
  try {
    const email = 'test-pass-login@example.com';
    const registerRes = await fetch('http://localhost:3003/api/auth/register', {
      method: 'POST',
      body: new URLSearchParams({
        role: 'client',
        name: 'Password Login Test',
        email,
        password: 'Test1234!',
        accepted_legal: 'true',
        company_name: 'Test Co',
        phone: '+1234567890'
      })
    });
    const registerData = await registerRes.json();
    console.log('Register status', registerRes.status, registerData);

    const loginRes = await fetch('http://localhost:3003/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test1234!' })
    });
    const loginData = await loginRes.json();
    console.log('Login status', loginRes.status, loginData);
  } catch (err) {
    console.error(err);
  }
})();
