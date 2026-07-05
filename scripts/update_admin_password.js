const bcrypt = require('bcryptjs');
const db = require('../shared/database/database');

const email = process.env.NEW_ADMIN_EMAIL;
const pass = process.env.NEW_ADMIN_PASS;

if (!email || !pass) {
  console.error('ERROR: Set environment variables NEW_ADMIN_EMAIL and NEW_ADMIN_PASS');
  process.exit(1);
}

(async () => {
  try {
    const hash = bcrypt.hashSync(pass, 10);
    const result = await db.run('UPDATE users SET password_hash = ? WHERE email = ? AND role = ?', [hash, email, 'admin']);
    console.log('Update result:', result);
    const user = await db.get('SELECT id, email, role FROM users WHERE email = ?', [email]);
    if (!user) {
      console.error('No admin user found with that email');
      process.exit(2);
    }
    console.log('Password updated for:', user.email);
    process.exit(0);
  } catch (err) {
    console.error('Error updating admin password:', err);
    process.exit(1);
  }
})();
