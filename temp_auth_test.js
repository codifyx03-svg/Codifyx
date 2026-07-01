const fetch = globalThis.fetch;
(async () => {
  try {
    const form = new FormData();
    form.append('role', 'client');
    form.append('name', 'Test Client X');
    form.append('email', 'testclientx@example.com');
    form.append('password', 'Password1!');
    form.append('company_name', 'Test Co');
    form.append('phone', '+1234567890');

    const reg = await fetch('http://localhost:3000/api/auth/register', { method: 'POST', body: form });
    console.log('REGISTER STATUS', reg.status);
    console.log(await reg.text());

    const login = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'testclientx@example.com', password: 'Password1!' })
    });
    console.log('LOGIN STATUS', login.status);
    console.log(await login.text());
  } catch (err) {
    console.error(err);
  }
})();
