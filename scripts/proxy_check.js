const fetch = require('node-fetch');
(async () => {
  const urls = ['http://localhost:3000/api/auth/login', 'http://localhost:3003/api/auth/login'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      console.log(url, res.status, text.slice(0, 400));
    } catch (err) {
      console.error(url, 'ERROR', err.message);
    }
  }
})();
