process.env.DB_ROLE = 'admin';
const express = require('express');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const database = require('../../shared/database/database');
const { logAuditEvent, logSecurityEvent } = require('../../shared/security/audit');
const { hashToken, generateSecureToken } = require('../../shared/security/crypto');
const { PayoutService } = require('../../shared/payments/payout');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.ADMIN_API_PORT || process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'devforce_admin_secure_secret_key_2026_x99';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEBUG_OTP = process.env.DEBUG_OTP === 'true' || NODE_ENV !== 'production';

// Trust proxy for rate-limiting
app.set('trust proxy', 1);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'admin-api' });
});

// ==========================================
// SECURITY MIDDLEWARES & HEADERS
// ==========================================
app.use(helmet());
app.use(express.json());

// Strict CORS setup for Admin system
const corsOptions = {
  origin: process.env.CORS_ALLOWED_ORIGINS 
    ? process.env.CORS_ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3002', 'http://127.0.0.1:3002'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// Rate limiter for Admin operations
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per window
  message: { error: 'Too many requests from this IP, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (DEBUG_OTP || NODE_ENV !== 'production') ? 1000 : 10, // Relaxed for local test scripts
  message: { error: 'Too many login attempts, please try again later.' }
});

app.use(adminLimiter);

// 1. IP Whitelisting Middleware
async function checkIpWhitelist(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  const cleanIp = clientIp.replace(/^::ffff:/, '');
  
  const whitelisted = await database.get('SELECT 1 FROM ip_whitelist WHERE ip_address = ?', [cleanIp])
    || cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost';
    
  if (!whitelisted) {
    // Log intrusion attempt
    await database.run(
      'INSERT INTO security_events (event_type, ip_address, details, severity) VALUES (?, ?, ?, ?)',
      ['unauthorized_ip_attempt', cleanIp, `Blocked admin access attempt from non-whitelisted IP: ${cleanIp}`, 'high']
    );
    return res.status(403).json({ error: 'Access denied: IP address is not whitelisted' });
  }
  next();
}

app.use(checkIpWhitelist);

// 2. Authentication Middelware
function authenticateAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthenticated' });

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err || decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Invalid session token' });
    }

    // Verify session in active database records
    const sessionActive = await database.get('SELECT 1 FROM admin_sessions WHERE session_token = ? AND active = 1', [token]);
    if (!sessionActive) {
      return res.status(403).json({ error: 'Session expired or logged out' });
    }

    req.user = decoded;
    next();
  });
}

// 3. RBAC Guards
function authorizeAdminRoles(...allowedRoles) {
  return (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    // Super admin has full permissions
    if (req.user.admin_role === 'super') {
      return next();
    }
    if (allowedRoles.includes(req.user.admin_role)) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: Insufficient privileges for role: ${req.user.admin_role}` });
  };
}

// 4. Audit Log Middleware — uses shared/audit.js with checksums
async function logAdminAction(req, res, next) {
  const originalJson = res.json;
  res.json = function(data) {
    if (data && data.success && req.user) {
      const action = `${req.method} ${req.originalUrl}`;
      const cleanIp = (req.ip || req.connection.remoteAddress).replace(/^::ffff:/, '');
      const details = { ...req.body };
      if (details.password) delete details.password;
      logAuditEvent({
        action,
        userId: req.user.id,
        userEmail: req.user.email,
        role: req.user.admin_role || 'admin',
        details: JSON.stringify(details),
        ipAddress: cleanIp,
        severity: 'medium'
      });
    }
    return originalJson.apply(this, arguments);
  };
  next();
}

// Apply audit log to mutating requests
app.use(['/api/admin/workers', '/api/admin/projects', '/api/admin/tasks', '/api/admin/promote', '/api/admin/demote', '/api/admin/security/whitelist'], logAdminAction);

// ==========================================
// ADMIN AUTHENTICATION (Portal endpoints)
// ==========================================

// Hidden Portal Login: Verify Username & Password and directly issue JWT + Refresh Tokens (2FA deactivated)
app.post('/api/admin/auth/portal-secure-login-x97', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await database.get('SELECT * FROM users WHERE email = ? AND role = "admin"', [email]);
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account lockout
    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.status(403).json({ error: `Account locked due to consecutive failed logins. Please try again after ${new Date(admin.locked_until).toLocaleTimeString()}` });
    }

    // IDS velocity check — block IP if >10 failed attempts in 5 min
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentAttempts = await database.get(
      `SELECT COUNT(*) as cnt FROM login_velocity WHERE ip_address = ? AND attempt_at > ?`,
      [req.ip, fiveMinAgo]
    );
    if (recentAttempts && recentAttempts.cnt >= 10) {
      await logSecurityEvent({ eventType: 'ids_ip_velocity_block', ipAddress: req.ip, details: `IP blocked: ${recentAttempts.cnt} failed logins in 5 min`, severity: 'critical' });
      return res.status(429).json({ error: 'Too many failed attempts. IP temporarily blocked.' });
    }
    await database.run('INSERT INTO login_velocity (ip_address) VALUES (?)', [req.ip]);

    const validPass = await database.verifyPassword(password, admin.password_hash);
    if (!validPass) {
      // Increment login attempts and lock if >= 3
      const attempts = (admin.login_attempts || 0) + 1;
      let lockUpdateSql = 'UPDATE users SET login_attempts = ? WHERE id = ?';
      const params = [attempts, admin.id];
      if (attempts >= 3) {
        const lockTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        lockUpdateSql = 'UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?';
        params.splice(1, 0, lockTime);
        await logSecurityEvent({ eventType: 'auth_lockout', ipAddress: req.ip.replace(/^::ffff:/, ''), details: `Admin lockout: ${email} after 3 failed attempts`, severity: 'high' });
      }
      await database.run(lockUpdateSql, params);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset login attempts on correct password step
    await database.run('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?', [admin.id]);

    // Create session JWT payload
    const payload = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      admin_role: admin.admin_role,
      jti: crypto.randomBytes(16).toString('hex')
    };

    // Access token valid for 15 mins (Inactivity log-out support)
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const cleanIp = req.ip.replace(/^::ffff:/, '');

    // Terminate any previous active sessions (Single active session rule)
    await database.run('UPDATE admin_sessions SET active = 0 WHERE admin_id = ?', [admin.id]);

    // Save session in database
    await database.run(
      `INSERT INTO admin_sessions (admin_id, session_token, refresh_token, expires_at, ip_address, user_agent, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [admin.id, token, refreshToken, refreshExpires, cleanIp, req.headers['user-agent']]
    );

    res.json({
      success: true,
      token,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        admin_role: admin.admin_role
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Refresh Admin Token (Token Rotation)
app.post('/api/admin/auth/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const session = await database.get(
      'SELECT * FROM admin_sessions WHERE refresh_token = ? AND active = 1 AND expires_at > CURRENT_TIMESTAMP',
      [refreshToken]
    );

    if (!session) return res.status(403).json({ error: 'Invalid or expired refresh session' });

    const admin = await database.get('SELECT id, email, name, role, admin_role FROM users WHERE id = ?', [session.admin_id]);
    
    const payload = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      admin_role: admin.admin_role,
      jti: crypto.randomBytes(16).toString('hex')
    };

    const newToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Rotate tokens (Invalidate old session and create a new one)
    await database.run('UPDATE admin_sessions SET active = 0 WHERE id = ?', [session.id]);
    await database.run(
      `INSERT INTO admin_sessions (admin_id, session_token, refresh_token, expires_at, ip_address, user_agent, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [admin.id, newToken, newRefreshToken, refreshExpires, session.ip_address, req.headers['user-agent']]
    );

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Admin Logout
app.post('/api/admin/auth/logout', authenticateAdminToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    await database.run('UPDATE admin_sessions SET active = 0 WHERE session_token = ?', [token]);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==========================================
// PASSWORD RESET (Admin accounts)
// ==========================================

// Step 1: Request a password reset link
app.post('/api/admin/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const admin = await database.get('SELECT id, email, name FROM users WHERE email = ? AND role = "admin"', [email.toLowerCase().trim()]);

    // Always return success — never reveal if email exists (prevents enumeration)
    if (!admin) return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });

    // Invalidate any existing tokens for this user
    await database.run('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [admin.id]);

    // Generate cryptographically secure token
    const rawToken = generateSecureToken(32); // 32 random bytes = 64 hex chars
    const tokenHash = hashToken(rawToken);     // SHA-256 hash stored in DB
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    await database.run(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [admin.id, tokenHash, expiresAt]
    );

    const resetUrl = `http://localhost:3002/reset-password.html?token=${rawToken}&uid=${admin.id}`;

    // In production: send via email. In dev: log to console.
    console.log(`\n📨 [Password Reset] Admin: ${admin.email}`);
    console.log(`   Reset URL (expires in 15 min): ${resetUrl}\n`);

    await logAuditEvent({ action: 'admin_password_reset_requested', userId: admin.id, userEmail: admin.email, role: 'admin', ipAddress: req.ip, details: 'Reset token generated', severity: 'medium' });

    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.', ...(process.env.NODE_ENV !== 'production' ? { dev_reset_url: resetUrl } : {}) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Step 2: Submit new password with reset token
app.post('/api/admin/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, userId, newPassword } = req.body;
    if (!token || !userId || !newPassword) return res.status(400).json({ error: 'Token, userId, and newPassword required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const tokenHash = hashToken(token);
    const resetRecord = await database.get(
      `SELECT * FROM password_reset_tokens
       WHERE user_id = ? AND token_hash = ? AND used = 0 AND expires_at > datetime('now')`,
      [userId, tokenHash]
    );

    if (!resetRecord) return res.status(400).json({ error: 'Invalid or expired reset token' });

    // Hash new password with Argon2id
    const newHash = await database.hashPassword(newPassword);

    // Update password and invalidate token (single use)
    await database.run('UPDATE users SET password_hash = ?, login_attempts = 0, locked_until = NULL WHERE id = ?', [newHash, userId]);
    await database.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);
    // Invalidate all active admin sessions for this user (force re-login)
    await database.run('UPDATE admin_sessions SET active = 0 WHERE admin_id = ?', [userId]);

    const admin = await database.get('SELECT email FROM users WHERE id = ?', [userId]);
    await logAuditEvent({ action: 'admin_password_reset_completed', userId, userEmail: admin?.email || '?', role: 'admin', ipAddress: req.ip, details: 'Password successfully reset', severity: 'high' });

    res.json({ success: true, message: 'Password reset successful. Please log in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ==========================================
// ADMIN CONTROL ENDPOINTS (RESTRICTED BY RBAC)
// ==========================================

// 1. Worker Approval Management (Project/Super Admin)
app.get('/api/admin/workers/pending', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const workers = await database.query("SELECT id, name, email, skills, resume_url, experience, available_hours FROM users WHERE role = 'worker' AND approved = 0");
    res.json({ success: true, workers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load pending workers' });
  }
});

app.post('/api/admin/workers/:id/approve', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { action } = req.body;
    const workerId = req.params.id;

    if (action === 'approve') {
      await database.run('UPDATE users SET approved = 1 WHERE id = ?', [workerId]);
      res.json({ success: true, message: 'Worker approved successfully.' });
    } else {
      await database.run('DELETE FROM users WHERE id = ?', [workerId]);
      res.json({ success: true, message: 'Worker rejected.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update worker approval' });
  }
});

app.get('/api/admin/workers/approved', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const workers = await database.query("SELECT id, name, email, skills, experience, experience_years FROM users WHERE role = 'worker' AND approved = 1 ORDER BY experience_years DESC");
    res.json({ success: true, workers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load workers' });
  }
});

// Get worker profile and task stats
app.get('/api/admin/workers/:id/profile-stats', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const workerId = req.params.id;
    const worker = await database.get(
      'SELECT id, name, email, phone, age, skills, experience, available_hours, approved, verified FROM users WHERE id = ? AND role = ?',
      [workerId, 'worker']
    );
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const stats = await database.get(`
      SELECT 
        COUNT(*) as total_assigned,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'completed' AND (completed_at IS NULL OR deadline IS NULL OR completed_at <= deadline) THEN 1 ELSE 0 END) as on_time,
        SUM(CASE WHEN payment_status = 'approved' THEN payment_amount ELSE 0 END) as total_earned
      FROM tasks
      WHERE assigned_worker_id = ?
    `, [workerId]);

    const completedTasks = await database.query(`
      SELECT t.id, t.title, t.payment_amount, t.deadline, t.completed_at, p.title as project_title
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.assigned_worker_id = ? AND t.status = 'completed'
      ORDER BY t.completed_at DESC
    `, [workerId]);

    const coreMember = await database.get('SELECT id FROM core_members WHERE worker_id = ?', [workerId]);

    const reviewStats = await database.get(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE to_user_id = ?',
      [workerId]
    );

    res.json({
      success: true,
      worker,
      stats: {
        total_assigned: stats.total_assigned || 0,
        completed: stats.completed || 0,
        total_earned: stats.total_earned || 0,
        on_time: stats.on_time || 0,
        avg_rating: reviewStats ? reviewStats.avg_rating : null,
        review_count: reviewStats ? reviewStats.review_count : 0,
        is_core: !!coreMember
      },
      completed_tasks: completedTasks
    });
  } catch (error) {
    console.error('profile-stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// DELETE: Completely remove/delete a worker from the platform (clean up all references)
app.delete('/api/admin/workers/:id', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const workerId = Number(req.params.id);
    const worker = await database.get('SELECT id, name FROM users WHERE id = ? AND role = "worker"', [workerId]);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Clean up all worker tables
    await database.run('DELETE FROM group_members WHERE worker_id = ?', [workerId]);
    await database.run('DELETE FROM resumes WHERE user_id = ?', [workerId]);
    await database.run('DELETE FROM wallets WHERE user_id = ?', [workerId]);
    await database.run('DELETE FROM withdraw_requests WHERE worker_id = ?', [workerId]);
    await database.run('UPDATE tasks SET assigned_worker_id = NULL WHERE assigned_worker_id = ?', [workerId]);
    await database.run('DELETE FROM users WHERE id = ?', [workerId]);

    res.json({ success: true, message: `Worker "${worker.name}" removed successfully from active platform registry` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove worker' });
  }
});

// POST: Unassign worker from a task
app.post('/api/admin/tasks/:id/unassign', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const task = await database.get('SELECT status FROM tasks WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'completed') {
      return res.status(400).json({ error: 'Cannot unassign worker from completed task' });
    }
    await database.run('UPDATE tasks SET assigned_worker_id = NULL, status = "pending", progress = 0 WHERE id = ?', [taskId]);
    res.json({ success: true, message: 'Worker removed from task successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unassign worker' });
  }
});

// 2. Core Worker Management (Project/Super Admin)
app.get('/api/admin/core-members', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const members = await database.query(`
      SELECT cm.id, u.id as worker_id, u.name, u.email, cm.promoted_at
      FROM core_members cm
      JOIN users u ON cm.worker_id = u.id
      ORDER BY cm.promoted_at DESC
    `);
    res.json({ success: true, core_members: members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch core members' });
  }
});

app.post('/api/admin/promote-worker', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { worker_id, reason } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

    const exists = await database.get('SELECT id FROM core_members WHERE worker_id = ?', [worker_id]);
    if (exists) return res.status(400).json({ error: 'Worker already a core member' });

    await database.run('INSERT INTO core_members (worker_id, promotion_reason) VALUES (?, ?)', [worker_id, reason || 'Promoted']);
    res.json({ success: true, message: 'Worker promoted to core member' });
  } catch (error) {
    res.status(500).json({ error: 'Promotion failed' });
  }
});

app.post('/api/admin/demote-worker', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { worker_id } = req.body;
    await database.run('DELETE FROM core_members WHERE worker_id = ?', [worker_id]);
    res.json({ success: true, message: 'Worker demoted from core member' });
  } catch (error) {
    res.status(500).json({ error: 'Demotion failed' });
  }
});

// 3. Project & Budget Management (Project/Super Admin)
app.get('/api/admin/projects', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const projects = await database.query(`
      SELECT p.*, u.name as client_name 
      FROM projects p 
      JOIN users u ON p.client_id = u.id 
      ORDER BY p.id DESC
    `);
    for (let p of projects) {
      p.tasks = await database.query('SELECT * FROM tasks WHERE project_id = ?', [p.id]);
    }
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.post('/api/admin/projects/:id/status', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { status } = req.body;
    await database.run('UPDATE projects SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `Project status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project status' });
  }
});

app.delete('/api/admin/projects/:id', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    await database.run('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
    await database.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Project and all tasks deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

app.post('/api/admin/projects/:id/split', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { tasks, team_slots } = req.body;
    if (!tasks || !Array.isArray(tasks)) return res.status(400).json({ error: 'Tasks required' });

    await database.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    for (let t of tasks) {
      await database.run(
        `INSERT INTO tasks (project_id, title, description, deadline, payment_amount, working_time, progress, status, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
        [projectId, t.title, t.description, t.deadline, parseFloat(t.payment_amount), t.working_time || '20 hours']
      );
    }
    await database.run('UPDATE projects SET status = "in development", team_slots = ? WHERE id = ?', [parseInt(team_slots) || 4, projectId]);
    res.json({ success: true, message: 'Project split into tasks successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to split tasks' });
  }
});

app.post('/api/admin/projects/:id/request-revision', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { message, requestedBudget } = req.body;
    const projectId = req.params.id;

    await database.run(
      `UPDATE projects SET status = 'revision-requested', revision_requested_budget = ?, revision_message = ?, revision_requested_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [requestedBudget || null, message, projectId]
    );
    res.json({ success: true, message: 'Revision requested from client' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to request budget revision' });
  }
});

app.post('/api/admin/projects/:id/accept-revised-budget', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const projectId = req.params.id;
    await database.run(
      `UPDATE projects SET status = 'pending', revision_requested_budget = NULL, revision_message = NULL, revision_requested_at = NULL WHERE id = ?`,
      [projectId]
    );
    res.json({ success: true, message: 'Revised budget accepted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept budget' });
  }
});

app.post('/api/admin/projects/:id/reject-revised-budget', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { reason } = req.body;
    await database.run(
      `UPDATE projects SET status = 'revision-requested', revision_message = ? WHERE id = ?`,
      [reason || 'Rejected', projectId]
    );
    res.json({ success: true, message: 'Revised budget rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject budget' });
  }
});

app.post('/api/admin/tasks/:id/assign', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { workerId } = req.body;
    await database.run(
      `UPDATE tasks SET assigned_worker_id = ?, status = 'assigned', progress = 10 WHERE id = ?`,
      [workerId, req.params.id]
    );
    res.json({ success: true, message: 'Task assigned successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

app.put('/api/admin/tasks/:id/status', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { status, progress, payment_amount, payment_status, assigned_worker_id, client_approval_status, client_approval_note } = req.body;
    const updates = [];
    const values = [];

    if (typeof status !== 'undefined') { updates.push('status = ?'); values.push(status); }
    if (typeof progress !== 'undefined') { updates.push('progress = ?'); values.push(Number(progress)); }
    if (typeof payment_amount !== 'undefined') { updates.push('payment_amount = ?'); values.push(Number(payment_amount)); }
    if (typeof payment_status !== 'undefined') { updates.push('payment_status = ?'); values.push(payment_status); }
    if (typeof assigned_worker_id !== 'undefined') { updates.push('assigned_worker_id = ?'); values.push(assigned_worker_id); }
    if (typeof client_approval_status !== 'undefined') { updates.push('client_approval_status = ?'); values.push(client_approval_status); }
    if (typeof client_approval_note !== 'undefined') { updates.push('client_approval_note = ?'); values.push(client_approval_note); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided' });
    }

    values.push(taskId);
    await database.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: 'Task updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.patch('/api/admin/tasks/:id', authenticateAdminToken, authorizeAdminRoles('project', 'finance'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { status, progress, payment_amount, payment_status, assigned_worker_id, client_approval_status, client_approval_note } = req.body;
    const updates = [];
    const values = [];

    if (typeof status !== 'undefined') { updates.push('status = ?'); values.push(status); }
    if (typeof progress !== 'undefined') { updates.push('progress = ?'); values.push(Number(progress)); }
    if (typeof payment_amount !== 'undefined') { updates.push('payment_amount = ?'); values.push(Number(payment_amount)); }
    if (typeof payment_status !== 'undefined') { updates.push('payment_status = ?'); values.push(payment_status); }
    if (typeof assigned_worker_id !== 'undefined') { updates.push('assigned_worker_id = ?'); values.push(assigned_worker_id); }
    if (typeof client_approval_status !== 'undefined') { updates.push('client_approval_status = ?'); values.push(client_approval_status); }
    if (typeof client_approval_note !== 'undefined') { updates.push('client_approval_note = ?'); values.push(client_approval_note); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided' });
    }

    values.push(taskId);
    await database.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: 'Task updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// 4. Finance & Payment Operations (Finance/Super Admin)

// POST: Admin funds a project (seeds the Platform Wallet)
app.post('/api/admin/projects/:id/fund', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const adminId = req.user.id;
    const projectId = Number(req.params.id);
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    const project = await database.get('SELECT id, title FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await PayoutService.fundProjectWallet(projectId, Number(amount), adminId);
    await logAuditEvent(adminId, req.user.email, req.user.admin_role || 'finance', 'project_funded', {
      projectId, amount
    }, req.ip, req.headers['user-agent']);

    res.json({ success: true, message: `₹${amount} credited to platform wallet for project "${project.title}"` });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to fund project' });
  }
});

// GET: all tasks in 'review' state awaiting payment release
app.get('/api/admin/payment/queue', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const tasks = await database.query(`
      SELECT t.id, t.title, t.payment_amount, t.payment_status, t.status, t.client_approval_status,
             p.title as project_title,
             u.name as worker_name, u.email as worker_email
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN users u ON u.id = t.assigned_worker_id
       WHERE t.status = 'review' AND t.payment_status = 'pending' AND t.client_approval_status = 'approved'
       ORDER BY t.id DESC
    `);
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load payment queue' });
  }
});

// POST: Admin releases payment for a task via PayoutService
app.post('/api/admin/tasks/:id/approve-payment', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const adminId = req.user.id;
    const result = await PayoutService.releaseTaskPayment(Number(req.params.id), adminId);
    await logAuditEvent(adminId, req.user.email, req.user.admin_role || 'finance', 'task_payment_released', {
      taskId: result.taskId, workerId: result.workerId, amount: result.amount
    }, req.ip, req.headers['user-agent']);
    res.json({ success: true, message: `Payment of ₹${result.amount} released to worker`, result });
  } catch (error) {
    console.error('[payment] release error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to release payment' });
  }
});

// POST: Admin rejects task code submission (sends back for rework)
app.post('/api/admin/tasks/:id/reject-payment', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const { reason } = req.body;
    await database.run(
      `UPDATE tasks SET status = 'in progress', progress = 50, payment_status = 'pending' WHERE id = ?`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Submission rejected — sent back for rework' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject code submission' });
  }
});

// GET: Platform wallet overview
app.get('/api/admin/payment/wallets', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const platformBalance = await PayoutService.getBalance(0, 'platform');
    const workerWallets = await database.query(`
      SELECT w.user_id, w.balance, u.name, u.email
        FROM wallets w
        JOIN users u ON u.id = w.user_id
       WHERE w.wallet_type = 'worker'
       ORDER BY w.balance DESC
    `);
    const totalWorkerBalance = workerWallets.reduce((s, w) => s + (w.balance || 0), 0);
    res.json({ success: true, platformBalance, workerWallets, totalWorkerBalance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load wallet overview' });
  }
});

// GET: All worker payout records
app.get('/api/admin/payment/payouts', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const payouts = await database.query(`
      SELECT wp.*, u.name as worker_name, u.email as worker_email,
             a.name as released_by_name, t.title as task_title
        FROM worker_payouts wp
        JOIN users u ON u.id = wp.worker_id
        LEFT JOIN users a ON a.id = wp.released_by
        LEFT JOIN tasks t ON t.id = wp.task_id
       ORDER BY wp.id DESC
       LIMIT 200
    `);
    res.json({ success: true, payouts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load payout records' });
  }
});

// GET: Withdrawal requests
app.get('/api/admin/payment/withdrawals', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const requests = await database.query(`
      SELECT wr.*, u.name as worker_name, u.email as worker_email
        FROM withdraw_requests wr
        JOIN users u ON u.id = wr.worker_id
       ORDER BY wr.id DESC
       LIMIT 200
    `);
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load withdrawal requests' });
  }
});

// POST: Admin approves a withdrawal request
app.post('/api/admin/payment/withdrawals/:id/approve', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const adminId = req.user.id;
    const result = await PayoutService.approveWithdrawal(Number(req.params.id), adminId);
    await logAuditEvent(adminId, req.user.email, req.user.admin_role || 'finance', 'withdrawal_approved', result, req.ip, req.headers['user-agent']);
    res.json({ success: true, message: `Withdrawal of ₹${result.amount} approved`, result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to approve withdrawal' });
  }
});

// POST: Admin rejects a withdrawal request
app.post('/api/admin/payment/withdrawals/:id/reject', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const adminId = req.user.id;
    const { reason } = req.body;
    const result = await PayoutService.rejectWithdrawal(Number(req.params.id), adminId, reason);
    await logAuditEvent(adminId, req.user.email, req.user.admin_role || 'finance', 'withdrawal_rejected', { ...result, reason }, req.ip, req.headers['user-agent']);
    res.json({ success: true, message: 'Withdrawal request rejected', result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to reject withdrawal' });
  }
});

// GET: Financial audit trail
app.get('/api/admin/payment/audit-trail', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const trail = await PayoutService.getAuditTrail(300);
    res.json({ success: true, trail });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load audit trail' });
  }
});

app.get('/api/admin/analytics', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const totalRevenueRow = await database.get("SELECT SUM(budget) as total FROM projects WHERE status != 'rejected'");
    const activeWorkersRow = await database.get("SELECT COUNT(*) as count FROM users WHERE role = 'worker' AND approved = 1");
    const activeProjectsRow = await database.get("SELECT COUNT(*) as count FROM projects WHERE status = 'in development'");

    res.json({
      success: true,
      totalRevenue: totalRevenueRow.total || 0,
      activeWorkers: activeWorkersRow.count,
      activeProjects: activeProjectsRow.count,
      monthlyProfit: Math.round((totalRevenueRow.total || 0) * 0.15)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

app.get('/api/admin/reports', authenticateAdminToken, authorizeAdminRoles('finance'), async (req, res) => {
  try {
    const workersReport = await database.query(`
      SELECT u.id, u.name, u.email, 
             SUM(CASE WHEN t.payment_status = 'approved' THEN t.payment_amount ELSE 0 END) as total_earned
      FROM users u
      LEFT JOIN tasks t ON u.id = t.assigned_worker_id
      WHERE u.role = 'worker' AND u.approved = 1
      GROUP BY u.id
    `);
    res.json({ success: true, workersReport });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Legal Document Management for Admins
app.get('/api/admin/legal/documents', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const docs = await database.query('SELECT * FROM legal_documents ORDER BY document_type, version DESC');
    res.json({ success: true, documents: docs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load legal documents' });
  }
});

app.post('/api/admin/legal/documents', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const { document_type, title, content, active } = req.body;
    if (!document_type || !title || !content) {
      return res.status(400).json({ error: 'Document type, title, and content are required' });
    }

    const latest = await database.get('SELECT MAX(version) as latest FROM legal_documents WHERE document_type = ?', [document_type]);
    const nextVersion = (latest && latest.latest) ? latest.latest + 1 : 1;

    if (active) {
      await database.run('UPDATE legal_documents SET active = 0 WHERE document_type = ?', [document_type]);
    }

    const result = await database.run(
      `INSERT INTO legal_documents (document_type, version, title, content, active, published_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [document_type, nextVersion, title, content, active ? 1 : 0]
    );

    const createdDoc = await database.get('SELECT * FROM legal_documents WHERE id = ?', [result.lastID]);
    res.json({ success: true, document: createdDoc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create legal document' });
  }
});

app.put('/api/admin/legal/documents/:id', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const { title, content, active } = req.body;
    const doc = await database.get('SELECT * FROM legal_documents WHERE id = ?', [docId]);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (typeof active !== 'undefined' && active) {
      await database.run('UPDATE legal_documents SET active = 0 WHERE document_type = ?', [doc.document_type]);
    }

    await database.run(
      `UPDATE legal_documents SET title = COALESCE(?, title), content = COALESCE(?, content), active = COALESCE(?, active) WHERE id = ?`,
      [title, content, typeof active !== 'undefined' ? (active ? 1 : 0) : doc.active, docId]
    );

    const updatedDoc = await database.get('SELECT * FROM legal_documents WHERE id = ?', [docId]);
    res.json({ success: true, document: updatedDoc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update legal document' });
  }
});

app.get('/api/admin/legal/acceptances', authenticateAdminToken, authorizeAdminRoles('project'), async (req, res) => {
  try {
    const history = await database.query(`
      SELECT la.id, la.version, la.accepted_at, la.ip_address, la.user_agent,
             u.id as user_id, u.name as user_name, u.email as user_email,
             ld.document_type, ld.title as document_title
      FROM legal_acceptances la
      JOIN users u ON u.id = la.user_id
      JOIN legal_documents ld ON ld.id = la.document_id
      ORDER BY la.accepted_at DESC
      LIMIT 500
    `);
    res.json({ success: true, acceptances: history });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load legal acceptances' });
  }
});

// 5. Security logs, intrusion alerts & IP whitelist management (Security/Super Admin)
app.get('/api/admin/security/logs', authenticateAdminToken, authorizeAdminRoles('security'), async (req, res) => {
  try {
    const logs = await database.query('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 500');
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

app.get('/api/admin/security/alerts', authenticateAdminToken, authorizeAdminRoles('security'), async (req, res) => {
  try {
    const alerts = await database.query('SELECT * FROM security_events ORDER BY id DESC LIMIT 500');
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch security alerts' });
  }
});

app.get('/api/admin/security/whitelist', authenticateAdminToken, authorizeAdminRoles('security'), async (req, res) => {
  try {
    const ips = await database.query('SELECT * FROM ip_whitelist ORDER BY id DESC');
    res.json({ success: true, whitelist: ips });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load IP whitelist' });
  }
});

app.post('/api/admin/security/whitelist', authenticateAdminToken, authorizeAdminRoles('security'), async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address required' });

    await database.run('INSERT INTO ip_whitelist (ip_address) VALUES (?)', [ip]);
    res.json({ success: true, message: `IP ${ip} successfully whitelisted` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to whitelist IP' });
  }
});

app.delete('/api/admin/security/whitelist/:id', authenticateAdminToken, authorizeAdminRoles('security'), async (req, res) => {
  try {
    await database.run('DELETE FROM ip_whitelist WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'IP address removed from whitelist' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove IP from whitelist' });
  }
});

// WebSocket chat message broadcasting simulation for Admin notifications
function broadcastAdminEvent(event) {
  // Real-time notification stub
  console.log(`🔒 [SECURITY ALERT]: ${JSON.stringify(event)}`);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Express error handler
app.use((err, req, res, next) => {
  console.error('[Admin Server Error]:', err.message);
  res.status(err.status || 500).json({
    error: NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

database.initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n✅ Secure Admin API Server is running at http://localhost:${PORT}`);
    console.log(`🔒 IP Whitelisting active. Only approved IPs can access Admin routes.`);
  });
}).catch(err => {
  console.error('Failed to initialize admin database:', err.message);
  process.exit(1);
});
