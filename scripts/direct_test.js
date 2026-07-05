const fetch = require("node-fetch");
(async () => {
  try {
    const email = `direct-test-${Date.now()}@example.com`;
    const res = await fetch("http://localhost:3003/api/auth/register", {
      method: "POST",
      body: new URLSearchParams({
        role: "client",
        name: "Direct Test",
        email,
        password: "Test1234!",
        accepted_legal: 'true',
        company_name: "Direct Co",
        phone: "+1234567890"
      })
    });
    console.log('status', res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
})();
