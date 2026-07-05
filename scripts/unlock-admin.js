/**
 * unlock-admin.js
 * ──────────────────────────────────────────────────────────────
 * Run this if your admin account gets locked after 3 failed
 * login attempts. It clears the lockout immediately.
 *
 * Usage:
 *   node unlock-admin.js
 *   node unlock-admin.js koushishetty8109@gmail.com
 * ──────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

// Unlock a specific email, or ALL admin accounts if none given
const targetEmail = process.argv[2] || null;

db.serialize(() => {
  if (targetEmail) {
    console.log(`\n🔓 Unlocking account: ${targetEmail} ...\n`);
    db.run(
      `UPDATE users SET login_attempts = 0, locked_until = NULL WHERE email = ? AND role = 'admin'`,
      [targetEmail],
      function(err) {
        if (err) {
          console.error('❌ Error:', err.message);
        } else if (this.changes === 0) {
          console.error('⚠️  No admin account found with that email.');
        } else {
          console.log('✅ Account unlocked successfully!\n');
          console.log(`🔐 Login at: http://localhost:${process.env.FRONTEND_PORT || 3000}/admin`);
          console.log(`   Email:    ${targetEmail}`);
          console.log('   Password: (use the password from your .env file)\n');
        }
        db.close();
      }
    );
  } else {
    console.log('\n🔓 Unlocking ALL locked admin accounts...\n');
    db.run(
      `UPDATE users SET login_attempts = 0, locked_until = NULL WHERE role = 'admin'`,
      function(err) {
        if (err) {
          console.error('❌ Error:', err.message);
        } else {
          console.log(`✅ Unlocked ${this.changes} admin account(s).\n`);
          // Show current admins
          db.all(`SELECT id, email, name, admin_role FROM users WHERE role = 'admin'`, (err2, rows) => {
            if (!err2) {
              console.log('📋 Admin accounts:');
              console.table(rows);
            }
            console.log(`🔐 Login at: http://localhost:${process.env.FRONTEND_PORT || 3000}/admin\n`);
            db.close();
          });
        }
      }
    );
  }
});
