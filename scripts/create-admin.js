/**
 * scripts/create-admin.js
 * ─────────────────────────────────────────────────────────────
 * Secure CLI tool to create admin accounts.
 * Passwords are hashed with Argon2id — NEVER stored in .env.
 *
 * Usage:
 *   node scripts/create-admin.js
 *   node scripts/create-admin.js --email admin@co.com --role super
 * ─────────────────────────────────────────────────────────────
 */

'use strict';
require('dotenv').config();
const readline = require('readline');
const database = require('../shared/database');

let argon2;
let bcrypt;
try {
  argon2 = require('argon2');
} catch {
  bcrypt = require('bcryptjs');
  console.warn('⚠️  argon2 not available — using bcrypt fallback');
}

async function hashPassword(password) {
  if (argon2) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  }
  return bcrypt.hash(password, 12);
}

const VALID_ROLES = ['super', 'finance', 'project', 'security'];

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    process.stdout.write(question);
    // Temporarily mute output for password input
    const stdin = process.openStdin();
    process.stdin.setRawMode(true);
    let password = '';

    process.stdin.on('data', function handler(ch) {
      ch = ch.toString();
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (ch === '\u007F') {
        password = password.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(password.length));
      } else {
        password += ch;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n🔐 Codify — Secure Admin Account Creation\n');
  console.log('This tool creates admin accounts with Argon2id hashed passwords.');
  console.log('Credentials are NEVER stored in .env or any file.\n');

  // Parse CLI args
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  await database.initDb();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let email = getArg('--email') || await prompt(rl, 'Admin Email: ');
  let name  = getArg('--name')  || await prompt(rl, 'Display Name: ');
  let role  = getArg('--role')  || await prompt(rl, `Role (${VALID_ROLES.join('/')}): `);

  email = email.trim().toLowerCase();
  name  = name.trim();
  role  = role.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    console.error('❌ Invalid email address.');
    rl.close(); process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`❌ Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    rl.close(); process.exit(1);
  }

  rl.close();

  // Check for duplicates
  const existing = await database.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    console.error(`❌ An account with email "${email}" already exists.`);
    process.exit(1);
  }

  // Password entry (masked)
  let password;
  try {
    password = await promptPassword('Password (hidden): ');
  } catch {
    // Fallback for non-TTY environments (e.g. CI)
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await prompt(rl2, 'Password: ');
    rl2.close();
  }

  if (!password || password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exit(1);
  }

  console.log('\n⏳ Hashing password with Argon2id...');
  const hash = await hashPassword(password);
  password = null; // Clear from memory immediately

  await database.run(
    `INSERT INTO users (email, name, role, admin_role, password_hash, approved, verified)
     VALUES (?, ?, 'admin', ?, ?, 1, 1)`,
    [email, name, role, hash]
  );

  console.log(`\n✅ Admin account created successfully!`);
  console.log(`   Email : ${email}`);
  console.log(`   Name  : ${name}`);
  console.log(`   Role  : ${role}`);
  console.log(`   Hash  : ${argon2 ? 'Argon2id' : 'bcrypt'}`);
  console.log(`\n🔐 Login at: http://localhost:3002/portal-entry-secure-x97.html\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
