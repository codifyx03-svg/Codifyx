const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('🔄 Clearing all clients and workers from database...\n');
  
  db.run('DELETE FROM users WHERE role IN ("client", "worker")', function(err) {
    if (err) console.error('❌ Error deleting users:', err);
    else console.log(`✅ Deleted all clients and workers. Changes: ${this.changes}`);
  });

  db.run('DELETE FROM projects', function(err) {
    if (err) console.error('❌ Error deleting projects:', err);
    else console.log(`✅ Deleted all projects. Changes: ${this.changes}`);
  });

  db.run('DELETE FROM tasks', function(err) {
    if (err) console.error('❌ Error deleting tasks:', err);
    else console.log(`✅ Deleted all tasks. Changes: ${this.changes}`);
  });

  db.run('DELETE FROM groups', function(err) {
    if (err) console.error('❌ Error deleting groups:', err);
    else console.log(`✅ Deleted all groups. Changes: ${this.changes}`);
  });

  db.run('DELETE FROM group_members', function(err) {
    if (err) console.error('❌ Error deleting group members:', err);
    else console.log(`✅ Deleted all group members. Changes: ${this.changes}`);
  });

  db.run('DELETE FROM project_interest', function(err) {
    if (err) console.error('❌ Error deleting project interests:', err);
    else console.log(`✅ Deleted all project interests. Changes: ${this.changes}`);
  });

  // Show remaining users (should only be admin)
  db.all('SELECT id, email, role FROM users', (err, rows) => {
    if (err) console.error('❌ Error:', err);
    else {
      console.log('\n📋 Remaining users in database:');
      console.table(rows);
      console.log('\n✅ Database reset complete! Ready for fresh testing.\n');
      console.log('🔐 Admin Login Credentials:');
      console.log('   Email: koushishetty8109@gmail.com');
      console.log('   Password: admin123\n');
      db.close();
    }
  });
});
