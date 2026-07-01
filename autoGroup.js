// autoGroup.js - Helper to auto-create worker groups based on resume matching
const database = require('./database');

/**
 * Simple keyword match scoring between project technologies and worker resume content.
 * Returns a Promise resolving to the created group object.
 */
async function createAutoGroup(projectId, topN = 3) {
  // Load project details
  const project = await database.get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) throw new Error('Project not found');

  const techKeywords = (project.technologies || '')
    .toLowerCase()
    .split(/[,;\s]+/)
    .filter(Boolean);

  // Pull all workers with resumes and experience_years
  const workers = await database.query(`
    SELECT u.id, u.name, u.experience_years, r.content AS resume
    FROM users u
    LEFT JOIN resumes r ON r.user_id = u.id
    WHERE u.role = 'worker' AND u.approved = 1
  `);

  // Score workers
  const scored = workers.map(w => {
    const resumeText = (w.resume || '').toLowerCase();
    let matchCount = 0;
    for (const kw of techKeywords) {
      if (resumeText.includes(kw)) matchCount++;
    }
    const score = matchCount * 10 + (w.experience_years || 0);
    return { ...w, score };
  }).filter(w => w.score > 0);

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, topN);
  if (selected.length === 0) throw new Error('No suitable workers found for auto-group');

  // Create group entry
  const groupName = `Project ${project.id} Auto-Group`;
  const groupResult = await database.run(
    `INSERT INTO groups (name, client_id) VALUES (?, ?)`,
    [groupName, project.client_id]
  );
  const groupId = groupResult.id;

  // Insert members, marking highest scorer as leader
  for (let i = 0; i < selected.length; i++) {
    const member = selected[i];
    const isLeader = i === 0 ? 1 : 0;
    await database.run(
      `INSERT INTO group_members (group_id, worker_id, is_leader) VALUES (?, ?, ?)`,
      [groupId, member.id, isLeader]
    );
  }

  // Update tasks belonging to this project to reference the new group
  await database.run(
    `UPDATE tasks SET group_id = ? WHERE project_id = ?`,
    [groupId, projectId]
  );

  // Return group overview
  const members = await database.query(
    `SELECT gm.worker_id as id, u.name, u.email, gm.is_leader FROM group_members gm JOIN users u ON u.id = gm.worker_id WHERE gm.group_id = ?`,
    [groupId]
  );
  return { id: groupId, name: groupName, members };
}

module.exports = { createAutoGroup };
