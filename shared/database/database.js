const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

// Password hashing — prefer Argon2id, fall back to bcrypt if native build unavailable
let argon2, bcrypt;
try {
  argon2 = require('argon2');
} catch {
  bcrypt = require('bcryptjs');
  console.warn('[security] argon2 unavailable — using bcrypt fallback');
}

async function hashPassword(plaintext) {
  if (argon2) return argon2.hash(plaintext, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  return bcrypt.hash(plaintext, 12);
}

async function verifyPassword(plaintext, hash) {
  if (argon2) {
    // Handle both argon2id hashes and legacy bcrypt hashes gracefully
    if (hash && hash.startsWith('$argon2')) return argon2.verify(hash, plaintext);
    if (bcrypt) return bcrypt.compare(plaintext, hash); // legacy bcrypt row
    return false;
  }
  return bcrypt.compare(plaintext, hash);
}
const cryptoHelper = require('../security/crypto');
const { Pool } = require('pg');

const usePostgres = !!(process.env.DATABASE_URL || process.env.PGHOST);

let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
  console.log('🔌 Connecting to PostgreSQL Database...');
  const isExternal = process.env.DATABASE_URL.includes('render.com');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isExternal ? { rejectUnauthorized: false } : false
  });
} else {
  console.log('📦 Using local SQLite Database...');
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '..', 'database.db');
  sqliteDb = new sqlite3.Database(dbPath);
}

const db = sqliteDb;

function convertSqlForPostgres(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

function convertDdlForPostgres(sql) {
  let converted = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  converted = converted.replace(/PRIMARY KEY AUTOINCREMENT/gi, 'PRIMARY KEY');
  converted = converted.replace(/DATETIME/gi, 'TIMESTAMP');
  return converted;
}

let isInitializing = false;

function checkTablePermission(sql) {
  if (isInitializing) return;
  const dbRole = process.env.DB_ROLE || 'admin';
  if (dbRole === 'public') {
    const normalized = sql.trim().toLowerCase();
    // Allow DDL / Schema setup during startup
    if (normalized.startsWith('create') || normalized.startsWith('pragma') || normalized.startsWith('alter')) {
      return;
    }
    const restricted = ['admin_sessions', 'admin_audit_logs', 'security_events', 'ip_whitelist'];
    for (const table of restricted) {
      if (normalized.includes(table)) {
        throw new Error(`Permission Denied: Public API cannot access administrative table: ${table}`);
      }
    }
  }
}

async function transaction(work) {
  if (usePostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        run: (sql, params = []) => client.query(sql, params).then(res => ({ id: res.rows?.[0]?.id || null, changes: res.rowCount })),
        get: (sql, params = []) => client.query(sql, params).then(res => decryptRow(res.rows[0] || null)),
        query: (sql, params = []) => client.query(sql, params).then(res => decryptRows(res.rows))
      };
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return new Promise((resolve, reject) => {
    sqliteDb.exec('BEGIN TRANSACTION', async (err) => {
      if (err) return reject(err);

      const tx = {
        run: (sql, params = []) => new Promise((resolveRun, rejectRun) => {
          sqliteDb.run(sql, params, function (err2) {
            if (err2) return rejectRun(err2);
            resolveRun({ id: this.lastID, changes: this.changes });
          });
        }),
        get: (sql, params = []) => new Promise((resolveGet, rejectGet) => {
          sqliteDb.get(sql, params, (err2, row) => {
            if (err2) return rejectGet(err2);
            resolveGet(decryptRow(row));
          });
        }),
        query: (sql, params = []) => new Promise((resolveQuery, rejectQuery) => {
          sqliteDb.all(sql, params, (err2, rows) => {
            if (err2) return rejectQuery(err2);
            resolveQuery(decryptRows(rows));
          });
        })
      };

      try {
        const result = await work(tx);
        sqliteDb.exec('COMMIT', (commitErr) => {
          if (commitErr) return reject(commitErr);
          resolve(result);
        });
      } catch (workErr) {
        sqliteDb.exec('ROLLBACK', () => reject(workErr));
      }
    });
  });
}

function decryptRow(row) {
  if (!row) return row;
  if (typeof row.phone === 'string' && row.phone.includes(':')) {
    try {
      row.phone = cryptoHelper.decrypt(row.phone);
    } catch (e) {
      console.error('[database] Failed to decrypt phone field:', e.message);
    }
  }
  return row;
}

function decryptRows(rows) {
  if (!rows) return rows;
  if (Array.isArray(rows)) {
    return rows.map(decryptRow);
  }
  return decryptRow(rows);
}

function query(sql, params = []) {
  checkTablePermission(sql);
  if (usePostgres) {
    if (sql.includes('sqlite_master')) {
      return Promise.resolve([]);
    }
    let pgSql = sql;
    const pragmaMatch = sql.match(/PRAGMA\s+table_info\((\w+)\)/i);
    if (pragmaMatch) {
      const tableName = pragmaMatch[1].toLowerCase();
      pgSql = `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${tableName}'`;
    }
    pgSql = convertSqlForPostgres(pgSql);
    return pgPool.query(pgSql, params).then(res => decryptRows(res.rows));
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(decryptRows(rows));
    });
  });
}

function run(sql, params = []) {
  checkTablePermission(sql);
  if (usePostgres) {
    if (sql.trim().toUpperCase().startsWith('PRAGMA FOREIGN_KEYS')) {
      return Promise.resolve({ id: null, changes: 0 });
    }
    let pgSql = sql;
    if (sql.trim().toUpperCase().startsWith('CREATE TABLE') || sql.trim().toUpperCase().startsWith('ALTER TABLE')) {
      pgSql = convertDdlForPostgres(sql);
    }
    pgSql = convertSqlForPostgres(pgSql);
    let finalSql = pgSql;
    const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !sql.toUpperCase().includes('RETURNING')) {
      finalSql += ' RETURNING id';
    }
    return pgPool.query(finalSql, params).then(res => {
      const row = res.rows[0];
      return { 
         id: row ? row.id : null, 
         changes: res.rowCount 
      };
    });
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  checkTablePermission(sql);
  if (usePostgres) {
    if (sql.includes('sqlite_master')) {
      return Promise.resolve(null);
    }
    const pgSql = convertSqlForPostgres(sql);
    return pgPool.query(pgSql, params).then(res => decryptRow(res.rows[0] || null));
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(decryptRow(row));
    });
  });
}

async function initDb() {
  isInitializing = true;
  try {
    // Enable foreign keys
    await run('PRAGMA foreign_keys = ON');

  // Users Table
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT CHECK(role IN ('client', 'worker', 'admin')) NOT NULL,
    admin_role TEXT CHECK(admin_role IN ('super', 'finance', 'project', 'security')),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    company_name TEXT,
    phone TEXT,
    age INTEGER,
    skills TEXT,
    resume_url TEXT,
    experience TEXT,
    available_hours INTEGER,
    approved INTEGER DEFAULT 0,
    verification_code TEXT,
    verified INTEGER DEFAULT 0,
    experience_years INTEGER DEFAULT 0,
    google_id TEXT,
    phone_verified INTEGER DEFAULT 0,
    auth_method TEXT DEFAULT 'password',
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migrate existing users table if columns are missing
  const cols = await query(`PRAGMA table_info(users)`);
  const migrations = [
    { name: 'admin_role', sql: 'ALTER TABLE users ADD COLUMN admin_role TEXT CHECK(admin_role IN ("super", "finance", "project", "security"))' },
    { name: 'totp_secret', sql: 'ALTER TABLE users ADD COLUMN totp_secret TEXT' },
    { name: 'totp_enabled', sql: 'ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0' },
    { name: 'login_attempts', sql: 'ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0' },
    { name: 'locked_until', sql: 'ALTER TABLE users ADD COLUMN locked_until DATETIME' },
    { name: 'accepted_legal_version', sql: 'ALTER TABLE users ADD COLUMN accepted_legal_version INTEGER DEFAULT 0' },
    { name: 'accepted_legal_at', sql: 'ALTER TABLE users ADD COLUMN accepted_legal_at DATETIME' },
    { name: 'accepted_legal_ip', sql: 'ALTER TABLE users ADD COLUMN accepted_legal_ip TEXT' },
    { name: 'accepted_legal_user_agent', sql: 'ALTER TABLE users ADD COLUMN accepted_legal_user_agent TEXT' }
  ];
  for (const m of migrations) {
    if (!cols.some(c => c.name === m.name)) {
      try {
        await run(m.sql);
      } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }

  // OAuth Sessions Table (for temporary Google OAuth state storage)
  await run(`CREATE TABLE IF NOT EXISTS oauth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  )`);

  // OTP Sessions Table (for email and phone OTP storage)
  await run(`CREATE TABLE IF NOT EXISTS otp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    phone TEXT,
    otp_code TEXT NOT NULL,
    otp_type TEXT CHECK(otp_type IN ('email', 'phone')) NOT NULL,
    role TEXT NOT NULL,
    name TEXT,
    company_name TEXT,
    phone_number TEXT,
    age INTEGER,
    skills TEXT,
    experience TEXT,
    available_hours INTEGER,
    resume_url TEXT,
    verified_step INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    attempt_count INTEGER DEFAULT 0
  )`);

  // Resumes Table
  await run(`CREATE TABLE IF NOT EXISTS resumes (
    user_id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Projects Table
  await run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget REAL NOT NULL,
    budget_threshold REAL DEFAULT 0,
    deadline TEXT NOT NULL,
    technologies TEXT,
    file_url TEXT,
    status TEXT CHECK(status IN ('pending', 'in development', 'testing', 'completed', 'revision-requested', 'team-assigned', 'client-revised')) DEFAULT 'pending',
    revision_requested_budget REAL DEFAULT NULL,
    revision_message TEXT DEFAULT NULL,
    revision_requested_at DATETIME DEFAULT NULL,
    ai_analysis TEXT,
    progress INTEGER DEFAULT 0,
    worker_budget_pool REAL DEFAULT 0,
    project_type TEXT CHECK(project_type IN ('small', 'big')) DEFAULT 'big',
    team_slots INTEGER DEFAULT 4,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Groups Table
  await run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client_id INTEGER,
    leader_id INTEGER,
    project_id INTEGER,
    description TEXT,
    company_lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_approved_lead INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(leader_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // Tasks Table
  await run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    assigned_worker_id INTEGER,
    deadline TEXT NOT NULL,
    payment_amount REAL NOT NULL,
    progress INTEGER DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'assigned', 'in progress', 'review', 'completed')) DEFAULT 'pending',
    code_submission TEXT,
    payment_status TEXT CHECK(payment_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    client_approval_status TEXT CHECK(client_approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    client_approval_note TEXT,
    client_approved_at DATETIME,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    working_time TEXT DEFAULT '20 hours',
    completed_at DATETIME,
    locked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_worker_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  const taskCols = await query(`PRAGMA table_info(tasks)`);
  const taskMigrations = [
    { name: 'client_approval_status', sql: 'ALTER TABLE tasks ADD COLUMN client_approval_status TEXT CHECK(client_approval_status IN ("pending", "approved", "rejected")) DEFAULT "pending"' },
    { name: 'client_approval_note', sql: 'ALTER TABLE tasks ADD COLUMN client_approval_note TEXT' },
    { name: 'client_approved_at', sql: 'ALTER TABLE tasks ADD COLUMN client_approved_at DATETIME' }
  ];
  for (const migration of taskMigrations) {
    if (!taskCols.some(col => col.name === migration.name)) {
      await run(migration.sql);
    }
  }

  // Group Members Table
  await run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER,
    worker_id INTEGER,
    is_leader INTEGER DEFAULT 0,
    is_core_lead INTEGER DEFAULT 0,
    assigned_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    PRIMARY KEY (group_id, worker_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Group Invites Table
  await run(`CREATE TABLE IF NOT EXISTS group_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    status TEXT CHECK(status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
    invited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(group_id, worker_id)
  )`);

  // Core Members Table
  await run(`CREATE TABLE IF NOT EXISTS core_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL UNIQUE,
    promoted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    promotion_reason TEXT,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Worker Stats Table
  await run(`CREATE TABLE IF NOT EXISTS worker_stats (
    worker_id INTEGER PRIMARY KEY,
    completed_tasks INTEGER DEFAULT 0,
    total_tasks_assigned INTEGER DEFAULT 0,
    total_earnings REAL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Project Interest Table
  await run(`CREATE TABLE IF NOT EXISTS project_interest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    interested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(project_id, worker_id)
  )`);

  // Messages Table
  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Training Modules Table
  await run(`CREATE TABLE IF NOT EXISTS training_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    module_type TEXT CHECK(module_type IN ('React', 'Node.js', 'AI coding tools', 'GitHub workflow', 'UI design')) NOT NULL,
    video_url TEXT NOT NULL,
    description TEXT,
    quiz_json TEXT NOT NULL
  )`);

  // Worker Training Progress Table
  await run(`CREATE TABLE IF NOT EXISTS worker_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER,
    module_id INTEGER,
    completed INTEGER DEFAULT 0,
    quiz_score INTEGER,
    badge_awarded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(module_id) REFERENCES training_modules(id) ON DELETE CASCADE,
    UNIQUE(worker_id, module_id)
  )`);

  // Reviews Table
  await run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_user_id) REFERENCES users(id),
    FOREIGN KEY(to_user_id) REFERENCES users(id),
    FOREIGN KEY(project_id) REFERENCES projects(id)
  )`);

  // Worker Skills Table
  await run(`CREATE TABLE IF NOT EXISTS worker_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    proficiency_level TEXT CHECK(proficiency_level IN ('Beginner', 'Intermediate', 'Expert')),
    endorsements INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Portfolio Items Table
  await run(`CREATE TABLE IF NOT EXISTS portfolio_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    project_title TEXT NOT NULL,
    description TEXT,
    link TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // --- NEW SECURITY TABLES ---

  // Admin Sessions (Single session enforcement & Token rotation)
  await run(`CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    refresh_token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Admin Audit Logs (immutable — never UPDATE/DELETE rows)
  await run(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    admin_email TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    checksum TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Migrate audit log checksum column if missing
  const auditCols = await query(`PRAGMA table_info(admin_audit_logs)`);
  if (!auditCols.some(c => c.name === 'checksum')) {
    try { await run('ALTER TABLE admin_audit_logs ADD COLUMN checksum TEXT'); } catch(e) {}
  }

  // Password Reset Tokens
  await run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Login velocity tracking (for IDS brute-force detection)
  await run(`CREATE TABLE IF NOT EXISTS login_velocity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Security Events (Failed logins, suspicious patterns)
  await run(`CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    details TEXT,
    severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // IP Whitelist
  await run(`CREATE TABLE IF NOT EXISTS ip_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed IP Whitelist with localhost
  const hasLocal1 = await get('SELECT 1 FROM ip_whitelist WHERE ip_address = "127.0.0.1"');
  if (!hasLocal1) await run('INSERT INTO ip_whitelist (ip_address) VALUES ("127.0.0.1")');
  const hasLocal2 = await get('SELECT 1 FROM ip_whitelist WHERE ip_address = "::1"');
  if (!hasLocal2) await run('INSERT INTO ip_whitelist (ip_address) VALUES ("::1")');
  const hasLocal3 = await get('SELECT 1 FROM ip_whitelist WHERE ip_address = "::ffff:127.0.0.1"');
  if (!hasLocal3) await run('INSERT INTO ip_whitelist (ip_address) VALUES ("::ffff:127.0.0.1")');

  // ──────────────────────────────────────────────────────
  // PAYMENT INFRASTRUCTURE TABLES
  // ──────────────────────────────────────────────────────

  // Wallets — user_id = 0 is the Platform wallet (sentinel)
  await run(`CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    wallet_type TEXT CHECK(wallet_type IN ('client', 'platform', 'worker')) NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, wallet_type)
  )`);

  // Seed platform wallet (user_id = 0) if not exists
  const platformWallet = await get('SELECT 1 FROM wallets WHERE user_id = 0 AND wallet_type = "platform"');
  if (!platformWallet) await run('INSERT INTO wallets (user_id, wallet_type, balance) VALUES (0, "platform", 0)');

  // Worker Payouts — record of every payment released to a worker
  await run(`CREATE TABLE IF NOT EXISTS worker_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    task_id INTEGER,
    project_id INTEGER,
    amount REAL NOT NULL,
    released_by INTEGER NOT NULL,
    status TEXT CHECK(status IN ('released', 'reversed')) DEFAULT 'released',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY(released_by) REFERENCES users(id)
  )`);

  // Withdrawal Requests — workers request payout from their wallet
  await run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payout_details TEXT,
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'paid')) DEFAULT 'pending',
    rejection_reason TEXT,
    reviewed_by INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewed_by) REFERENCES users(id)
  )`);

  const withdrawalCols = await query(`PRAGMA table_info(withdraw_requests)`);
  if (!withdrawalCols.some(col => col.name === 'status')) {
    await run('ALTER TABLE withdraw_requests ADD COLUMN status TEXT CHECK(status IN ("pending", "approved", "rejected", "paid")) DEFAULT "pending"');
  }
  if (!usePostgres) {
    const withdrawTable = await get(`SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type = 'table'`, ['withdraw_requests']);
    const withdrawSql = withdrawTable?.sql || '';
    if (withdrawSql.includes("CHECK(status IN ('pending', 'approved', 'rejected'))")) {
      await run('ALTER TABLE withdraw_requests RENAME TO withdraw_requests_old');
      await run(`CREATE TABLE withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payout_details TEXT,
        status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'paid')) DEFAULT 'pending',
        rejection_reason TEXT,
        reviewed_by INTEGER,
        reviewed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(reviewed_by) REFERENCES users(id)
      )`);
      await run(`INSERT INTO withdraw_requests (id, worker_id, amount, payout_details, status, rejection_reason, reviewed_by, reviewed_at, created_at)
                 SELECT id, worker_id, amount, payout_details, status, rejection_reason, reviewed_by, reviewed_at, created_at FROM withdraw_requests_old`);
      await run('DROP TABLE withdraw_requests_old');
    }
  }
  // Financial Audit Trail — IMMUTABLE (never UPDATE or DELETE rows)
  await run(`CREATE TABLE IF NOT EXISTS financial_audit_trail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    reference_id INTEGER,
    amount REAL,
    actor_id INTEGER,
    details TEXT,
    checksum TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Legal Documents & User Acceptance Tracking
  await run(`CREATE TABLE IF NOT EXISTS legal_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type TEXT NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    active INTEGER DEFAULT 0,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_type, version)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS legal_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
  )`);

  const legalDocsCount = await get('SELECT COUNT(*) as count FROM legal_documents');
  if (legalDocsCount.count === 0) {
    await run(`INSERT INTO legal_documents (document_type, version, title, content, active) VALUES
      ('terms', 1, 'Terms of Service', 'Welcome to CodifyX. By using the platform, you agree to comply with the terms and conditions, remain honest in your statements, and consent to our dispute resolution and payment handling processes.', 1),
      ('privacy', 1, 'Privacy Policy', 'CodifyX collects personal information to operate the platform, protect your account, and comply with legal requirements. We do not sell your data and we retain it securely.', 1)
    `);
  }

  // Migrate tasks table: add 'released' to payment_status allowed values
  // (SQLite doesn't allow ALTER COLUMN CHECK, so we handle this at app logic level)
  // Ensure tasks that are already 'approved' can be read normally



  // ──────────────────────────────────────────────────────
  // Admin accounts are NOT seeded from .env (security rule).
  // Create admins using: node scripts/create-admin.js
  // ──────────────────────────────────────────────────────

  // Seed Training Modules
  const moduleCount = await get('SELECT COUNT(*) as count FROM training_modules');
  if (moduleCount.count === 0) {
    const modules = [
      {
        title: 'React Fundamentals for Modern Web Apps',
        type: 'React',
        url: 'https://www.youtube.com/embed/SqcY0GlETPk',
        description: 'Learn React Hooks, state management, components lifecycle, and responsive layouts.',
        quiz: JSON.stringify([
          { q: 'Which hook is used to perform side effects in functional components?', options: ['useState', 'useEffect', 'useContext', 'useReducer'], a: 1 },
          { q: 'What is the correct way to pass data from parent to child components?', options: ['Using state', 'Using props', 'Using context only', 'Using query params'], a: 1 },
          { q: 'What does JSX stand for?', options: ['JavaScript XML', 'Java Syntax Extension', 'JavaScript eXtended', 'JSON XML'], a: 0 }
        ])
      },
      {
        title: 'Building Scalable APIs with Node.js & Express',
        type: 'Node.js',
        url: 'https://www.youtube.com/embed/Oe421EPjeGs',
        description: 'Understand REST API architecture, Express routing, middleware orchestration, and database integration.',
        quiz: JSON.stringify([
          { q: 'How do you access path variables like /users/:id in Express?', options: ['req.body.id', 'req.query.id', 'req.params.id', 'req.headers.id'], a: 2 },
          { q: 'Which status code represents "Internal Server Error"?', options: ['400', '401', '404', '500'], a: 3 },
          { q: 'What is the role of body-parser middleware in Express?', options: ['Validate emails', 'Parse request body (e.g. JSON)', 'Secure endpoints', 'Manage sessions'], a: 1 }
        ])
      },
      {
        title: 'Mastering AI Coding Tools (Gemini & Copilot)',
        type: 'AI coding tools',
        url: 'https://www.youtube.com/embed/v7p7dD4k13M',
        description: 'Boost your developer productivity using LLM prompts, code generation, refactoring, and automatic test writing.',
        quiz: JSON.stringify([
          { q: 'What is a "zero-shot prompt"?', options: ['A prompt with no code examples', 'A prompt that fails', 'A prompt with many code examples', 'An interactive debugging session'], a: 0 },
          { q: 'How should you verify AI generated code before shipping it?', options: ['Trust it completely', 'Write unit tests and manual execution checks', 'Upload it straight to production', 'Ask another AI without testing'], a: 1 }
        ])
      },
      {
        title: 'Advanced Git and GitHub Collaboration Flow',
        type: 'GitHub workflow',
        url: 'https://www.youtube.com/embed/RGOj5yH7evk',
        description: 'Master branching models (GitFlow), rebase operations, resolve merge conflicts, and collaborate via PR reviews.',
        quiz: JSON.stringify([
          { q: 'Which command is used to combine files from one branch to another with cleaner history?', options: ['git commit', 'git merge', 'git rebase', 'git checkout'], a: 2 },
          { q: 'What is a pull request?', options: ['A request to pull code locally', 'A proposal to merge changes into a branch', 'An error report', 'A database migration request'], a: 1 }
        ])
      },
      {
        title: 'UI & UX Design Systems for Startups',
        type: 'UI design',
        url: 'https://www.youtube.com/embed/c9Wg6Ry_Ysg',
        description: 'Master visual hierarchies, custom color systems, mobile-responsive grids, and micro-interactions.',
        quiz: JSON.stringify([
          { q: 'Which visual principle makes important items stand out?', options: ['Visual Hierarchy', 'Consistency', 'Grid Alignment', 'Responsive Layout'], a: 0 },
          { q: 'What is glassmorphism in modern CSS?', options: ['Using backdrop-filter with border and semi-transparent backgrounds', 'Using backdrop-filter with border and semi-transparent backgrounds', 'A style with sharp shadows', 'A completely solid white theme'], a: 1 }
        ])
      }
    ];

    for (const mod of modules) {
      await run(`INSERT INTO training_modules (title, module_type, video_url, description, quiz_json)
                 VALUES (?, ?, ?, ?, ?)`, [mod.title, mod.type, mod.url, mod.description, mod.quiz]);
    }
    console.log('Seeded Training modules successfully.');
  }
  } finally {
    isInitializing = false;
  }
}

module.exports = {
  db,
  query,
  run,
  get,
  initDb,
  hashPassword,
  verifyPassword,
  transaction
};
