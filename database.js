const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const usePostgres = !!(process.env.DATABASE_URL || process.env.PGHOST);

let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
  console.log('🔌 Connecting to PostgreSQL Database...');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  console.log('📦 Using local SQLite Database...');
  const dbPath = path.join(__dirname, 'database.db');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Export the underlying db instance if needed, or null in PG
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

function query(sql, params = []) {
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
    return pgPool.query(pgSql, params).then(res => res.rows);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
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
  if (usePostgres) {
    if (sql.includes('sqlite_master')) {
      return Promise.resolve(null);
    }
    const pgSql = convertSqlForPostgres(sql);
    return pgPool.query(pgSql, params).then(res => res.rows[0] || null);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initDb() {
  // Enable foreign keys
  await run('PRAGMA foreign_keys = ON');

  // Users Table
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT CHECK(role IN ('client', 'worker', 'admin')) NOT NULL,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  // Add experience_years column if not exists
  const cols = await query(`PRAGMA table_info(users)`);
  const hasExp = cols.some(c => c.name === 'experience_years');
  if (!hasExp) {
    await run(`ALTER TABLE users ADD COLUMN experience_years INTEGER DEFAULT 0`);
  }

  // Add google_id column if not exists (not UNIQUE due to SQLite constraint with NULL values)
  const hasGoogleId = cols.some(c => c.name === 'google_id');
  if (!hasGoogleId) {
    await run(`ALTER TABLE users ADD COLUMN google_id TEXT`);
  }

  // Add phone_verified column if not exists
  const hasPhoneVerified = cols.some(c => c.name === 'phone_verified');
  if (!hasPhoneVerified) {
    await run(`ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0`);
  }

  // Add auth_method column if not exists (password, google, email-otp, phone-otp)
  const hasAuthMethod = cols.some(c => c.name === 'auth_method');
  if (!hasAuthMethod) {
    await run(`ALTER TABLE users ADD COLUMN auth_method TEXT DEFAULT 'password'`);
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
await run(`CREATE TABLE IF NOT EXISTS resumes (
    user_id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);`);

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    team_slots INTEGER DEFAULT 4,
    FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Add progress column to projects if not exists
  const projCols = await query(`PRAGMA table_info(projects)`);
  const hasProgress = projCols.some(c => c.name === 'progress');
  if (!hasProgress) {
    await run(`ALTER TABLE projects ADD COLUMN progress INTEGER DEFAULT 0`);
  }
  // Add worker_budget_pool column to projects if not exists
  const projCols2 = await query(`PRAGMA table_info(projects)`);
  if (!projCols2.some(c => c.name === 'worker_budget_pool')) {
    await run(`ALTER TABLE projects ADD COLUMN worker_budget_pool REAL DEFAULT 0`);
  }
  // Add project_type column to projects (small or big)
  const projCols3 = await query(`PRAGMA table_info(projects)`);
  if (!projCols3.some(c => c.name === 'project_type')) {
    await run(`ALTER TABLE projects ADD COLUMN project_type TEXT CHECK(project_type IN ('small', 'big')) DEFAULT 'big'`);
  }
  // Add team_slots column to projects if not exists
  if (!projCols3.some(c => c.name === 'team_slots')) {
    await run(`ALTER TABLE projects ADD COLUMN team_slots INTEGER DEFAULT 4`);
  }
  // Add revision request metadata columns to projects if not exists
  const projCols4 = await query(`PRAGMA table_info(projects)`);
  if (!projCols4.some(c => c.name === 'revision_requested_budget')) {
    await run(`ALTER TABLE projects ADD COLUMN revision_requested_budget REAL DEFAULT NULL`);
  }
  if (!projCols4.some(c => c.name === 'revision_message')) {
    await run(`ALTER TABLE projects ADD COLUMN revision_message TEXT DEFAULT NULL`);
  }
  if (!projCols4.some(c => c.name === 'revision_requested_at')) {
    await run(`ALTER TABLE projects ADD COLUMN revision_requested_at DATETIME DEFAULT NULL`);
  }

  // Migrate projects table if existing status constraint still lacks team-assigned or client-revised
  const projSqlRows = await query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'`);
  const projSql = projSqlRows[0] ? projSqlRows[0].sql : '';
  if (projSql.includes("CHECK(status IN ('pending', 'in development', 'testing', 'completed', 'revision-requested'))") ||
      (projSql.includes("CHECK") && !projSql.includes("'client-revised'"))) {
    console.log('Migrating projects table to support team-assigned and client-revised status');
    await run('PRAGMA foreign_keys = OFF');
    await run(`CREATE TABLE IF NOT EXISTS projects_new (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      progress INTEGER DEFAULT 0,
      worker_budget_pool REAL DEFAULT 0,
      project_type TEXT CHECK(project_type IN ('small', 'big')) DEFAULT 'big',
      team_slots INTEGER DEFAULT 4,
      FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await run(`INSERT INTO projects_new (id, client_id, title, description, budget, budget_threshold, deadline, technologies, file_url, status, revision_requested_budget, revision_message, revision_requested_at, ai_analysis, created_at, progress, worker_budget_pool, project_type, team_slots)
      SELECT id, client_id, title, description, budget, budget_threshold, deadline, technologies, file_url, status, NULL, NULL, NULL, ai_analysis, created_at, progress, worker_budget_pool, project_type, COALESCE(team_slots, 4) FROM projects`);
    await run(`DROP TABLE projects`);
    await run(`ALTER TABLE projects_new RENAME TO projects`);
    await run('PRAGMA foreign_keys = ON');
  }

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_worker_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  // Ensure group_id and working_time and completed_at columns in tasks exist
  await (async () => {
    const taskCols = await query(`PRAGMA table_info(tasks)`);
    if (!taskCols.some(c => c.name === 'group_id')) {
      try { await run(`ALTER TABLE tasks ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!taskCols.some(c => c.name === 'working_time')) {
      try { await run(`ALTER TABLE tasks ADD COLUMN working_time TEXT DEFAULT '20 hours'`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!taskCols.some(c => c.name === 'completed_at')) {
      try { await run(`ALTER TABLE tasks ADD COLUMN completed_at DATETIME`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
  })();

  // Ensure groups table exists and has description column
  await run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client_id INTEGER,
    leader_id INTEGER,
    project_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(leader_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  await (async () => {
    const groupCols = await query(`PRAGMA table_info(groups)`);
    if (!groupCols.some(c => c.name === 'description')) {
      try { await run(`ALTER TABLE groups ADD COLUMN description TEXT`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!groupCols.some(c => c.name === 'project_id')) {
      try { await run(`ALTER TABLE groups ADD COLUMN project_id INTEGER`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!groupCols.some(c => c.name === 'company_lead_id')) {
      try { await run(`ALTER TABLE groups ADD COLUMN company_lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!groupCols.some(c => c.name === 'is_approved_lead')) {
      try { await run(`ALTER TABLE groups ADD COLUMN is_approved_lead INTEGER DEFAULT 0`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
  })();

  // Ensure group_members table exists and has is_leader column
  await run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER,
    worker_id INTEGER,
    PRIMARY KEY (group_id, worker_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await (async () => {
    const gmCols = await query(`PRAGMA table_info(group_members)`);
    if (!gmCols.some(c => c.name === 'is_leader')) {
      try { await run(`ALTER TABLE group_members ADD COLUMN is_leader INTEGER DEFAULT 0`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!gmCols.some(c => c.name === 'is_core_lead')) {
      try { await run(`ALTER TABLE group_members ADD COLUMN is_core_lead INTEGER DEFAULT 0`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
    if (!gmCols.some(c => c.name === 'assigned_task_id')) {
      try { await run(`ALTER TABLE group_members ADD COLUMN assigned_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
  })();

  // Group Invites Table (for company lead invitations)
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

  // Core Members Table (admin-managed list of core/lead workers)
  await run(`CREATE TABLE IF NOT EXISTS core_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL UNIQUE,
    promoted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    promotion_reason TEXT,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Worker Stats Table (track completed tasks for promotion eligibility)
  await run(`CREATE TABLE IF NOT EXISTS worker_stats (
    worker_id INTEGER PRIMARY KEY,
    completed_tasks INTEGER DEFAULT 0,
    total_tasks_assigned INTEGER DEFAULT 0,
    total_earnings REAL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Project Interest Table (for big projects - workers express interest)
  await run(`CREATE TABLE IF NOT EXISTS project_interest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    interested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(worker_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(project_id, worker_id)
  )`);

  // Messages Table (Real-time & Chat history)
  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Ensure group_id column in messages exists
  await (async () => {
    const msgCols = await query(`PRAGMA table_info(messages)`);
    if (!msgCols.some(c => c.name === 'group_id')) {
      try { await run(`ALTER TABLE messages ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
  })();

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

  // Seed Admin user with a known developer password for local testing.
  const adminEmail = 'koushishetty8109@gmail.com';
  const adminPasswordHash = '$2a$10$vK9Z.lozkWGxV/qUgOGkWOfgsraWgKb5rUp3G/X.tWNl4xVr.XxDy';
  const adminExists = await get('SELECT id, password_hash FROM users WHERE email = ?', [adminEmail]);
  if (!adminExists) {
    await run(`INSERT INTO users (role, email, password_hash, name, approved, verified) 
               VALUES ('admin', ?, ?, 'System Admin', 1, 1)`, [adminEmail, adminPasswordHash]);
    console.log('Seeded Admin account successfully.');
  } else if (adminExists.password_hash !== adminPasswordHash) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [adminPasswordHash, adminExists.id]);
    console.log('Updated existing Admin account password for local seed consistency.');
  }

  // Seed Training Modules
  const moduleCount = await get('SELECT COUNT(*) as count FROM training_modules');
  if (moduleCount.count === 0) {
    const modules = [
      {
        title: 'React Fundamentals for Modern Web Apps',
        type: 'React',
        url: 'https://www.youtube.com/embed/SqcY0GlETPk', // Standard embed code template
        description: 'Learn React Hooks, state management, components lifecycle, and responsive layouts.',
        quiz: JSON.stringify([
          {
            q: 'Which hook is used to perform side effects in functional components?',
            options: ['useState', 'useEffect', 'useContext', 'useReducer'],
            a: 1
          },
          {
            q: 'What is the correct way to pass data from parent to child components?',
            options: ['Using state', 'Using props', 'Using context only', 'Using query params'],
            a: 1
          },
          {
            q: 'What does JSX stand for?',
            options: ['JavaScript XML', 'Java Syntax Extension', 'JavaScript eXtended', 'JSON XML'],
            a: 0
          }
        ])
      },
      {
        title: 'Building Scalable APIs with Node.js & Express',
        type: 'Node.js',
        url: 'https://www.youtube.com/embed/Oe421EPjeGs',
        description: 'Understand REST API architecture, Express routing, middleware orchestration, and database integration.',
        quiz: JSON.stringify([
          {
            q: 'How do you access path variables like /users/:id in Express?',
            options: ['req.body.id', 'req.query.id', 'req.params.id', 'req.headers.id'],
            a: 2
          },
          {
            q: 'Which status code represents "Internal Server Error"?',
            options: ['400', '401', '404', '500'],
            a: 3
          },
          {
            q: 'What is the role of body-parser middleware in Express?',
            options: ['Validate emails', 'Parse request body (e.g. JSON)', 'Secure endpoints', 'Manage sessions'],
            a: 1
          }
        ])
      },
      {
        title: 'Mastering AI Coding Tools (Gemini & Copilot)',
        type: 'AI coding tools',
        url: 'https://www.youtube.com/embed/v7p7dD4k13M',
        description: 'Boost your developer productivity using LLM prompts, code generation, refactoring, and automatic test writing.',
        quiz: JSON.stringify([
          {
            q: 'What is a "zero-shot prompt"?',
            options: ['A prompt with no code examples', 'A prompt that fails', 'A prompt with many code examples', 'An interactive debugging session'],
            a: 0
          },
          {
            q: 'How should you verify AI generated code before shipping it?',
            options: ['Trust it completely', 'Write unit tests and manual execution checks', 'Upload it straight to production', 'Ask another AI without testing'],
            a: 1
          }
        ])
      },
      {
        title: 'Advanced Git and GitHub Collaboration Flow',
        type: 'GitHub workflow',
        url: 'https://www.youtube.com/embed/RGOj5yH7evk',
        description: 'Master branching models (GitFlow), rebase operations, resolve merge conflicts, and collaborate via PR reviews.',
        quiz: JSON.stringify([
          {
            q: 'Which command is used to combine files from one branch to another with cleaner history?',
            options: ['git commit', 'git merge', 'git rebase', 'git checkout'],
            a: 2
          },
          {
            q: 'What is a pull request?',
            options: ['A request to pull code locally', 'A proposal to merge changes into a branch', 'An error report', 'A database migration request'],
            a: 1
          }
        ])
      },
      {
        title: 'UI & UX Design Systems for Startups',
        type: 'UI design',
        url: 'https://www.youtube.com/embed/c9Wg6Ry_Ysg',
        description: 'Master visual hierarchies, custom color systems, mobile-responsive grids, and micro-interactions.',
        quiz: JSON.stringify([
          {
            q: 'Which visual principle makes important items stand out?',
            options: ['Visual Hierarchy', 'Consistency', 'Grid Alignment', 'Responsive Layout'],
            a: 0
          },
          {
            q: 'What is glassmorphism in modern CSS?',
            options: ['Using bright neon backgrounds', 'Using backdrop-filter with border and semi-transparent backgrounds', 'A style with sharp shadows', 'A completely solid white theme'],
            a: 1
          }
        ])
      }
    ];

    for (const mod of modules) {
      await run(`INSERT INTO training_modules (title, module_type, video_url, description, quiz_json)
                 VALUES (?, ?, ?, ?, ?)`, [mod.title, mod.type, mod.url, mod.description, mod.quiz]);
    }
    console.log('Seeded Training modules successfully.');
  }
}

module.exports = {
  db,
  query,
  run,
  get,
  initDb
};
