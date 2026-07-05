const fetch = require('node-fetch');
(async () => {
  try {
    const email = `proxy-test-${Date.now()}@example.com`;
    const registerRes = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      body: new URLSearchParams({
        role: 'client',
        name: 'Proxy Test User',
        email,
        password: 'ProxyTest1!',
        company_name: 'Proxy Co',
        phone: '+1234567890'
      })
    });
    const registerData = await registerRes.json();
    console.log('3000 register status', registerRes.status, registerData);

    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password:'ProxyTest1!'})
    });
    const loginData = await loginRes.json();
    console.log('3000 login status', loginRes.status, loginData);
  } catch (err) {
    console.error(err);
  }
})();
