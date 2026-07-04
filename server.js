const { spawn } = require('child_process');
const express = require('express');
const path = require('path');

// Port mappings
const PORT_CLIENT = 3000;
const PORT_WORKER = 3001;
const PORT_ADMIN = 3002;

// 1. Serve Client Website
const clientApp = express();
clientApp.use(express.static(path.join(__dirname, 'client-web')));
clientApp.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client-web', 'index.html')));
clientApp.listen(PORT_CLIENT, () => {
  console.log(`🌐 [Client Website] Running at http://localhost:${PORT_CLIENT}`);
});

// 2. Serve Worker Website
const workerApp = express();
workerApp.use(express.static(path.join(__dirname, 'worker-web')));
workerApp.get('*', (req, res) => res.sendFile(path.join(__dirname, 'worker-web', 'login.html')));
workerApp.listen(PORT_WORKER, () => {
  console.log(`👷 [Worker Website] Running at http://localhost:${PORT_WORKER}`);
});

// 3. Serve Secure Admin Website (isolated) + proxy /api/* → admin-api:3004
const { createProxyMiddleware } = require('http-proxy-middleware');
const adminApp = express();

// Proxy all /api/ calls from the admin frontend to the admin API backend
// This keeps everything on the same origin (port 3002) — no CORS issues
adminApp.use(createProxyMiddleware({
  pathFilter: '/api',
  target: 'http://localhost:3004',
  changeOrigin: true
}));

adminApp.use(express.static(path.join(__dirname, 'admin-web')));
adminApp.get('*', (req, res) => res.sendFile(path.join(__dirname, 'admin-web', 'portal-entry-secure-x97.html')));
adminApp.listen(PORT_ADMIN, () => {
  console.log(`🛡️  [Admin Portal Website] Running at http://localhost:${PORT_ADMIN}`);
});

// 4. Start Public API Backend
console.log('🚀 Starting Public API Backend...');
const publicApi = spawn('node', ['public-api/server.js'], { stdio: 'inherit', shell: true });

// 5. Start Admin API Backend
console.log('🚀 Starting Secure Admin API Backend...');
const adminApi = spawn('node', ['admin-api/server.js'], { stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
  console.log('\nStopping all services...');
  publicApi.kill();
  adminApi.kill();
  process.exit();
});
