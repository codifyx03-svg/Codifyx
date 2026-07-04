require('dotenv').config();
const db = require('../shared/database');
const { hashPassword } = require('../shared/database');

async function seed() {
  await db.initDb();
  const admins = [
    { email: 'super_admin@company.com',    name: 'Super Admin',    role: 'super',    pass: 'superadmin123' },
    { email: 'finance_admin@company.com',  name: 'Finance Admin',  role: 'finance',  pass: 'financeadmin123' },
    { email: 'project_admin@company.com',  name: 'Project Admin',  role: 'project',  pass: 'projectadmin123' },
    { email: 'security_admin@company.com', name: 'Security Admin', role: 'security', pass: 'securityadmin123' },
    { email: 'koushishetty8109@gmail.com', name: 'System Admin',   role: 'super',    pass: '@Koushi2005' }
  ];
  for (const a of admins) {
    const hash = await hashPassword(a.pass);
    const exists = await db.get('SELECT id FROM users WHERE email = ?', [a.email]);
    if (!exists) {
      await db.run(
        'INSERT INTO users (email,name,role,admin_role,password_hash,approved,verified) VALUES (?,?,"admin",?,?,1,1)',
        [a.email, a.name, a.role, hash]
      );
      console.log('Created:', a.email);
    } else {
      await db.run(
        'UPDATE users SET password_hash=?, admin_role=?, login_attempts=0, locked_until=NULL WHERE id=?',
        [hash, a.role, exists.id]
      );
      console.log('Updated:', a.email);
    }
  }
  console.log('All admin accounts seeded with Argon2id hashes.');
  process.exit(0);
}
seed().catch(e => { console.error(e); process.exit(1); });
