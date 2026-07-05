const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Port mappings
const PORT_CLIENT = 3000;
const PORT_ADMIN = 3002;

// 1. Serve Client and Worker Website on the same host
const mainApp = express();

// Proxy public API requests from the main site to the public-api backend.
// This ensures browser requests to /api/* are forwarded correctly when
// the static site is served from http://localhost:3000.
mainApp.use('/api', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  pathRewrite: (path, req) => {
    // Debug the incoming proxy path to verify rewrite behavior.
    console.log('[PATH REWRITE]', 'incoming:', path);
    if (path === '/health' || path === '/api/health') {
      console.log('[PATH REWRITE]', 'rewritten to /health');
      return '/health';
    }
    if (path.startsWith('/api/')) {
      console.log('[PATH REWRITE]', 'rewritten to', path);
      return path;
    }
    const rewritten = `/api${path}`;
    console.log('[PATH REWRITE]', 'rewritten to', rewritten);
    return rewritten;
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('[MAIN PROXY REQ]', req.method, req.originalUrl, '=>', proxyReq.path);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('[MAIN PROXY RES]', req.method, req.originalUrl, 'status', proxyRes.statusCode);
  }
}));

mainApp.use(express.static(path.join(__dirname, 'apps', 'client-web')));
mainApp.use('/worker', express.static(path.join(__dirname, 'apps', 'worker-web')));
mainApp.get('/worker', (_req, res) => res.redirect('/worker/login.html'));
mainApp.get('/worker/*', (req, res) => {
  const filePath = path.join(__dirname, 'apps', 'worker-web', req.path.replace(/^\/worker\//, ''));
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  return res.sendFile(path.join(__dirname, 'apps', 'worker-web', 'login.html'));
});
mainApp.get('*', (req, res) => res.sendFile(path.join(__dirname, 'apps', 'client-web', 'index.html')));
mainApp.listen(PORT_CLIENT, () => {
  console.log(`🌐 [Main Website] Running at http://localhost:${PORT_CLIENT}`);
});

// 2. Serve Secure Admin Website (isolated) + proxy /api/* → admin-api:3004
const adminApp = express();

// Route admin chat-related endpoints to the public API backend so the
// admin portal can use the shared messaging engine while keeping admin
// management traffic on the secured admin backend.
adminApp.use('/api/messages', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  pathRewrite: (path, req) => {
    if (path.startsWith('/api/')) {
      return path;
    }
    return `/api${path}`;
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('[ADMIN CHAT PROXY REQ]', req.method, req.originalUrl, '=>', proxyReq.path);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('[ADMIN CHAT PROXY RES]', req.method, req.originalUrl, 'status', proxyRes.statusCode);
  }
}));

// Proxy all other admin API calls to the secure admin backend.
adminApp.use('/api', createProxyMiddleware({
  target: 'http://localhost:3004',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  pathRewrite: (path, req) => {
    if (path.startsWith('/api/')) {
      return path;
    }
    return `/api${path}`;
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('[ADMIN PROXY REQ]', req.method, req.originalUrl, '=>', proxyReq.path);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('[ADMIN PROXY RES]', req.method, req.originalUrl, 'status', proxyRes.statusCode);
  }
}));

adminApp.use(express.static(path.join(__dirname, 'apps', 'admin-web')));
adminApp.get('*', (req, res) => res.sendFile(path.join(__dirname, 'apps', 'admin-web', 'portal-entry-secure-x97.html')));
adminApp.listen(PORT_ADMIN, () => {
  console.log(`🛡️  [Admin Portal Website] Running at http://localhost:${PORT_ADMIN}`);
});

// 4. Start Public API Backend
console.log('🚀 Starting Public API Backend...');
const publicApi = spawn('node', ['apps/public-api/server.js'], { stdio: 'inherit', shell: true });

// 5. Start Admin API Backend
console.log('🚀 Starting Secure Admin API Backend...');
const adminApi = spawn('node', ['apps/admin-api/server.js'], { stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
  console.log('\nStopping all services...');
  publicApi.kill();
  adminApi.kill();
  process.exit();
});
