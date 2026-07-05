const fetch = require("node-fetch");
(async () => {
  try {
    const email = `proxy-test-${Date.now()}@example.com`;
    const body = new URLSearchParams({
      role: 'client',
      name: 'Proxy Test',
      email,
      password: 'ProxyTest1!',
      accepted_legal: 'true',
      company_name: 'Proxy Co',
      phone: '+1234567890'
    });

    const res = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      body
    });
    console.log('status', res.status);
    console.log(await res.text());
  } catch (e) {
    console.error('err', e.message);
  }
})();
