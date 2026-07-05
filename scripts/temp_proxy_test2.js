const fetch = require('node-fetch');
(async () => {
  try {
    const email = `proxy-test-${Date.now()}@example.com`;
    const formData = new URLSearchParams({
      role: 'client',
      name: 'Proxy Test',
      email,
      password: 'ProxyTest1!',
      accepted_legal: 'true',
      company_name: 'Proxy Co',
      phone: '+1234567890'
    });

    console.log('Testing direct public API POST register');
    const directReg = await fetch('http://localhost:3003/api/auth/register', { method: 'POST', body: formData });
    console.log('direct status', directReg.status, await directReg.text());

    console.log('Testing proxied POST register');
    const proxiedReg = await fetch('http://localhost:3000/api/auth/register', { method: 'POST', body: formData });
    console.log('proxy status', proxiedReg.status, await proxiedReg.text());

    const loginPayload = JSON.stringify({ email, password: 'ProxyTest1!' });
    console.log('Testing direct public API POST login');
    const directLogin = await fetch('http://localhost:3003/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: loginPayload });
    console.log('direct login status', directLogin.status, await directLogin.text());

    console.log('Testing proxied POST login');
    const proxiedLogin = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: loginPayload });
    console.log('proxy login status', proxiedLogin.status, await proxiedLogin.text());
  } catch (err) {
    console.error('ERR', err);
  }
})();
