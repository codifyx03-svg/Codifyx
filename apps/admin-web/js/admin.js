// ==========================================
// DEVFORCE INDIA - ADMIN DASHBOARD LOGIC
// ==========================================

let activeUser = null;
let chatSocket = null;
let currentChatContactId = null;
let cachedProjects = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Initialize search filters for worker tables
  const pendingSearch = document.getElementById('pending-worker-search');
  const vettedSearch = document.getElementById('vetted-worker-search');

  const filterPending = () => {
    const query = pendingSearch.value.toLowerCase();
    const rows = document.querySelectorAll('#pending-workers-table-body tr');
    rows.forEach(row => {
      const txt = row.textContent.toLowerCase();
      row.style.display = txt.includes(query) ? '' : 'none';
    });
  };

  const filterVetted = () => {
    const query = vettedSearch.value.toLowerCase();
    const rows = document.querySelectorAll('#vetted-workers-table-body tr');
    rows.forEach(row => {
      const txt = row.textContent.toLowerCase();
      row.style.display = txt.includes(query) ? '' : 'none';
    });
  };

  if (pendingSearch) pendingSearch.addEventListener('input', filterPending);
  if (vettedSearch) vettedSearch.addEventListener('input', filterVetted);

  // SECURITY BYPASS: Disable strict admin auth redirect for local testing.
  // To re-enable admin auth, restore the lines below and remove the fallback user.
  // activeUser = checkAuth(['admin']);
  // if (!activeUser) return;
  activeUser = getUser() || { id: null, name: 'Local Admin', role: 'admin', admin_role: 'super' };

  // Set Profile labels
  document.getElementById('admin-name-label').innerText = activeUser.name;
  document.getElementById('admin-avatar').innerText = activeUser.name.charAt(0).toUpperCase();
  document.querySelector('.user-role').innerText = `${activeUser.admin_role.toUpperCase()} ADMIN`;

  setupNavigation();
  enforceRBAC(activeUser.admin_role);

  if (activeUser.admin_role !== 'security') {
    loadDashboardSummary();
    loadUnreadMessagesCount();
    chatSocket = connectChatWS(handleIncomingChatMessage, handleSentMessageConfirm);
  }
});

// Setup navigation
function setupNavigation() {
  const menuItems = document.querySelectorAll('.sidebar-menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.getAttribute('data-view');

      // Update active sidebar item
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Update active view panel
      document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${view}`).classList.add('active');

      // Adjust headers & Load data
      const title = document.getElementById('view-title');
      const subtitle = document.getElementById('view-subtitle');

      switch(view) {
        case 'dashboard':
          title.innerText = 'Platform Analytics';
          subtitle.innerText = 'Monitor overall GMV revenue, margins, and completion cycles';
          loadDashboardSummary();
          break;
        case 'manage-workers':
          title.innerText = 'Developer Operations';
          subtitle.innerText = 'Screen pending worker registrations and manage contractor access';
          loadWorkersManagement();
          break;
        case 'project-management':
          title.innerText = 'Project Management';
          subtitle.innerText = 'Verify client briefs, run AI auto-splits, and allocate tasks';
          loadProjectsBoard();
          break;
        case 'payment-control':
          title.innerText = 'Payment Control & Audits';
          subtitle.innerText = 'Approve completed tasks and disburse escrow salaries';
          loadPaymentControl();
          break;
        case 'chat-support':
          title.innerText = 'Platform Messaging Center';
          subtitle.innerText = 'Consult with active clients and engineers on technical specifications';
          loadChatSupport();
          break;
        case 'manage-groups':
          title.innerText = 'Groups Management';
          subtitle.innerText = 'Create, edit, and assign workers to groups';
          loadGroupsManagement();
          break;
        case 'reports':
          title.innerText = 'Reports & Audits';
          subtitle.innerText = 'Analyze developers salary reports and active pipeline sheets';
          loadReports();
          break;
        case 'manage-legal':
          title.innerText = 'Legal Compliance';
          subtitle.innerText = 'Manage Terms, Privacy policy versions, and acceptance history';
          loadLegalManagement();
          break;
        case 'security':
          title.innerText = 'Security Control & Audit Logs';
          subtitle.innerText = 'Verify IP whitelists, review intrusion events, and browse administrative audit logs';
          loadSecurityControl();
          break;
      }
    });
  });
}

// ------------------------------------------
// VIEW 1: DASHBOARD SUMMARY
// ------------------------------------------
async function loadDashboardSummary() {
  try {
    // Fetch Analytics Stats
    const statsRes = await fetch('/api/admin/analytics', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const stats = await statsRes.json();
    if (!statsRes.ok) throw new Error(stats.error);

    document.getElementById('stats-revenue').innerText = `₹${stats.totalRevenue.toLocaleString('en-IN')}`;
    document.getElementById('stats-active-workers').innerText = stats.activeWorkers;
    document.getElementById('stats-active-projects').innerText = stats.activeProjects;

    // Fetch Projects summary list
    const projRes = await fetch('/api/admin/projects', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const projData = await projRes.json();
    if (!projRes.ok) throw new Error(projData.error);

    const projects = projData.projects;
    const tbody = document.getElementById('admin-projects-summary-body');
    tbody.innerHTML = '';

    projects.forEach(p => {
      // Calculate overall progress
      let completedTasksCount = 0;
      let totalTasksCount = p.tasks ? p.tasks.length : 0;
      let progressPercent = 0;

      if (totalTasksCount > 0) {
        p.tasks.forEach(t => {
          if (t.status === 'completed') completedTasksCount++;
        });
        progressPercent = Math.round((completedTasksCount / totalTasksCount) * 100);
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.title}</strong></td>
        <td>${p.company_name || p.client_name}</td>
        <td>
          <div style="display:flex; align-items:center; gap:0.5rem">
            <div style="flex:1; height:6px; min-width:80px; background:rgba(255,255,255,0.05); border-radius:99px; overflow:hidden">
              <div style="width:${progressPercent}%; height:100%; background:var(--grad-primary); border-radius:99px"></div>
            </div>
            <span>${progressPercent}%</span>
          </div>
        </td>
        <td>₹${p.budget.toLocaleString('en-IN')}</td>
        <td><span class="status-badge ${p.status.replace(' ', '-')}">${p.status}</span></td>
      `;
      tbody.appendChild(tr);
    });

    if (projects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No projects submitted yet on the platform.</td></tr>`;
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 2: MANAGE WORKERS (Screening / Approvals)
// ------------------------------------------
async function loadWorkersManagement() {
  const pendingTbody = document.getElementById('pending-workers-table-body');
  const vettedTbody = document.getElementById('vetted-workers-table-body');

  pendingTbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading worker applications...</td></tr>';
  vettedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Loading active developers...</td></tr>';

  try {
    // 1. Fetch Pending
    const pendingRes = await fetch('/api/admin/workers/pending', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const pendingData = await pendingRes.json();
    if (!pendingRes.ok) throw new Error(pendingData.error);

    pendingTbody.innerHTML = '';
    pendingData.workers.forEach(w => {
      const tr = document.createElement('tr');
      const resumeLink = w.resume_url 
        ? `<a href="${w.resume_url}" target="_blank" style="color:var(--color-primary)">View Resume</a>` 
        : '<span style="color:var(--text-muted)">No File</span>';

      tr.innerHTML = `
        <td><strong>${w.name}</strong> (Age: ${w.age || 'N/A'})</td>
        <td>${w.email}</td>
        <td><span style="color:#a855f7">${w.skills || 'None'}</span></td>
        <td>${resumeLink}</td>
        <td>
          <button class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin-right:0.25rem" onclick="processWorkerOnboard(${w.id}, 'approve')">Approve</button>
          <button class="btn btn-primary" style="background:#ef4444; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="processWorkerOnboard(${w.id}, 'reject')">Reject</button>
        </td>
      `;
      pendingTbody.appendChild(tr);
    });

    if (pendingData.workers.length === 0) {
      pendingTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No pending worker registrations in the queue.</td></tr>`;
    }

    // 2. Fetch Active Vetted
    const vettedRes = await fetch('/api/admin/workers/approved', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const vettedData = await vettedRes.json();
    if (!vettedRes.ok) throw new Error(vettedData.error);

    // Fetch Core Members list to identify core status
    const coreRes = await fetch('/api/admin/core-members', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const coreData = await coreRes.json();
    const coreIds = (coreData.core_members || []).map(c => c.worker_id);

    vettedTbody.innerHTML = '';
    vettedData.workers.forEach(w => {
      const isCore = coreIds.includes(w.id);
      const promoteBtn = isCore 
        ? `<button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; padding:0.3rem 0.6rem; font-size:0.75rem; color:#fff; margin-right:0.25rem;" onclick="demoteWorkerFromCore(${w.id})">Demote</button>`
        : `<button class="btn btn-primary" style="background:#3b82f6; border-color:#2563eb; padding:0.3rem 0.6rem; font-size:0.75rem; margin-right:0.25rem;" onclick="promoteWorkerToCore(${w.id})">Promote to Core</button>`;

      const coreBadge = isCore ? `<span class="status-badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; border-color:#f59e0b; font-size:0.7rem; padding:0.15rem 0.35rem; margin-left:0.5rem; display:inline-block; vertical-align:middle;">⭐ Core</span>` : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${w.id}</td>
        <td>
          <a href="#" style="color:#fff; font-weight:600; text-decoration:none;" onclick="openWorkerProfile(${w.id}); return false;">${w.name}</a>
          ${coreBadge}
        </td>
        <td>${w.email}</td>
        <td><span style="color:#10b981">${w.skills || 'General Developer'}</span></td>
        <td><span style="color:#a855f7">${w.experience || 'N/A'}</span></td>
        <td>
          <button class="btn btn-secondary" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-color:var(--color-primary); color:#fff; margin-right:0.25rem;" onclick="openWorkerProfile(${w.id})">🔍 View Stats</button>
          ${promoteBtn}
          <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; padding:0.3rem 0.6rem; font-size:0.75rem;" onclick="removeWorker(${w.id})">Remove</button>
        </td>
      `;
      vettedTbody.appendChild(tr);
    });

    if (vettedData.workers.length === 0) {
      vettedTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">No approved developers active yet.</td></tr>`;
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openWorkerProfile(workerId) {
  try {
    const response = await fetch(`/api/admin/workers/${workerId}/profile-stats`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const w = data.worker;
    const s = data.stats;
    const completedTasks = data.completed_tasks || [];

    // Calculate metrics
    const completionRate = s.total_assigned > 0 ? Math.round((s.completed / s.total_assigned) * 100) : 0;
    const onTimeRate = s.completed > 0 ? Math.round((s.on_time / s.completed) * 100) : 0;
    const ratingDisplay = s.avg_rating ? `⭐ ${parseFloat(s.avg_rating).toFixed(1)} / 5.0 (${s.review_count} reviews)` : 'No ratings yet';

    // Core membership status button
    const promoteBtn = s.is_core
      ? `<button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; flex:1;" onclick="closeWorkerProfileModal(); demoteWorkerFromCore(${w.id})">Demote from Core</button>`
      : `<button class="btn btn-primary" style="background:#3b82f6; border-color:#2563eb; color:#fff; flex:1;" onclick="closeWorkerProfileModal(); promoteWorkerToCore(${w.id})">Promote to Core</button>`;
    const removeBtn = `<button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; flex:1;" onclick="closeWorkerProfileModal(); removeWorker(${w.id})">🗑 Remove Developer</button>`;
    const actionBtn = `<div style="display:flex; gap:0.75rem; margin-bottom:1rem;">${promoteBtn}${removeBtn}</div>`;

    // Build tasks listing
    let tasksHTML = '';
    if (completedTasks.length > 0) {
      tasksHTML = `<div style="margin-top:1.5rem; border-top:1px solid rgba(255,255,255,0.08); padding-top:1rem;">
        <h4 style="margin-top:0; margin-bottom:0.75rem; color:var(--color-primary)">Recently Completed Projects/Tasks</h4>
        <div style="max-height: 200px; overflow-y: auto; display:flex; flex-direction:column; gap:0.5rem; padding-right:0.5rem;">`;
      completedTasks.forEach(t => {
        const completedDate = new Date(t.completed_at).toLocaleDateString();
        tasksHTML += `
          <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); padding:0.75rem; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:0.85rem; color:#fff">${t.title}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted)">Project: ${t.project_title}</div>
            </div>
            <div style="text-align:right">
              <strong style="color:var(--color-secondary); font-size:0.85rem">₹${t.payment_amount.toLocaleString('en-IN')}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted)">Done: ${completedDate}</div>
            </div>
          </div>
        `;
      });
      tasksHTML += `</div></div>`;
    } else {
      tasksHTML = `<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic; margin-top:1rem;">No completed projects or tasks recorded.</p>`;
    }

    const content = document.getElementById('worker-profile-content');
    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0; font-size:1.4rem; color:#fff">${w.name}</h2>
          <span style="font-size:0.85rem; color:var(--text-muted)">Approved Developer${s.is_core ? ' · ⭐ Core Member' : ''}</span>
        </div>
        <span class="status-badge" style="background:${s.is_core ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}; color:${s.is_core ? '#f59e0b' : '#3b82f6'}; border-color:${s.is_core ? '#f59e0b' : '#3b82f6'};">
          ${s.is_core ? 'Core' : 'Standard'}
        </span>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.25rem; margin-bottom:1.5rem;">
        <!-- Left: Details -->
        <div class="glass-card" style="padding:1rem; background:rgba(255,255,255,0.02)">
          <h4 style="margin-top:0; margin-bottom:0.75rem; color:var(--color-primary)">Developer Profile</h4>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Email:</strong> ${w.email}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Phone:</strong> ${w.phone || 'N/A'}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Age:</strong> ${w.age || 'N/A'}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Weekly Avail:</strong> ${w.available_hours || 0} hours</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Skills:</strong> <span style="color:#10b981">${w.skills || 'N/A'}</span></p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Experience:</strong> ${w.experience || 'N/A'}</p>
        </div>

        <!-- Right: Metrics -->
        <div class="glass-card" style="padding:1rem; background:rgba(255,255,255,0.02)">
          <h4 style="margin-top:0; margin-bottom:0.75rem; color:var(--color-primary)">Performance Metrics</h4>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Total Assigned:</strong> ${s.total_assigned}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Completed Tasks:</strong> ${s.completed}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Completion Rate:</strong> ${completionRate}%</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">On-Time Submissions:</strong> ${onTimeRate}%</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Rating Score:</strong> ${ratingDisplay}</p>
          <p style="margin:0.4rem 0; font-size:0.85rem"><strong style="color:var(--text-secondary)">Total Revenue:</strong> <span style="color:var(--color-secondary); font-weight:600">₹${s.total_earned.toLocaleString('en-IN')}</span></p>
        </div>
      </div>

      ${actionBtn}
      ${tasksHTML}
    `;

    document.getElementById('worker-profile-modal').classList.add('active');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeWorkerProfileModal() {
  document.getElementById('worker-profile-modal').classList.remove('active');
}

async function promoteWorkerToCore(workerId) {
  const reason = prompt("Enter promotion reason (optional):");
  if (reason === null) return; // Admin cancelled

  try {
    const res = await fetch('/api/admin/promote-worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ worker_id: workerId, reason: reason || 'Promoted to core developer status' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadWorkersManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function demoteWorkerFromCore(workerId) {
  if (!confirm("Are you sure you want to demote this worker from Core Member status?")) return;

  try {
    const res = await fetch('/api/admin/demote-worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ worker_id: workerId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadWorkersManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function processWorkerOnboard(workerId, action) {
  try {
    const response = await fetch(`/api/admin/workers/${workerId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ action })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadWorkersManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeWorker(workerId) {
  if (!confirm("Are you sure you want to completely remove this developer from the platform? This will deactivate their account and unassign them from any active tasks.")) return;
  try {
    const res = await fetch(`/api/admin/workers/${workerId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadWorkersManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function unassignTaskWorker(taskId) {
  if (!confirm("Are you sure you want to remove this worker from the task?")) return;
  try {
    const res = await fetch(`/api/admin/tasks/${taskId}/unassign`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    
    // Reload active project details
    const projId = document.getElementById('split-project-id').value;
    openProjectManagementDetails(Number(projId));
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 3: PROJECT MANAGEMENT & AI TASK SPLITTER
// ------------------------------------------
async function loadProjectsBoard() {
  const tbody = document.getElementById('admin-projects-board-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading projects board...</td></tr>';

  try {
    const response = await fetch('/api/admin/projects', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    tbody.innerHTML = '';
    cachedProjects = data.projects;

    cachedProjects.forEach(p => {
      let actionBtn = '';
      // Check if this pending project had a budget revised by client (revision flags are cleared)
      const wasRevised = p.status === 'pending' && !p.revision_requested_budget && !p.revision_message;
      if (p.status === 'pending') {
        actionBtn = `
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap">
            <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem" onclick="openProjectSplitWizard(${p.id})">Review &amp; Split</button>
            <button class="btn btn-secondary" style="background:#f59e0b; border-color:#d97706; color:#fff; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="openBudgetRevisionModal(${p.id}, ${p.budget})">Revise Budget</button>
            <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="adminCancelProject(${p.id})">Cancel</button>
          </div>
        `;
      } else if (p.status === 'revision-requested') {
        actionBtn = `
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap">
            <span style="color:var(--text-muted); font-size:0.85rem; align-self:center">Awaiting Revision</span>
            <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="adminCancelProject(${p.id})">Cancel</button>
          </div>`;
      } else if (p.status === 'client-revised') {
        // Client submitted a revised budget — admin can accept or reject it
        actionBtn = `
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center">
            <span style="font-size:0.8rem; color:#f59e0b; align-self:center">💰 Client revised budget to ₹${p.budget.toLocaleString('en-IN')}</span>
            <button class="btn btn-primary" style="background:#10b981; border-color:#059669; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="adminAcceptRevisedBudget(${p.id})">✓ Accept Budget</button>
            <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="adminRejectRevisedBudget(${p.id})">✗ Reject Budget</button>
            <button class="btn btn-secondary" style="background:#f59e0b; border-color:#d97706; color:#fff; padding:0.4rem 0.8rem; font-size:0.8rem" onclick="openBudgetRevisionModal(${p.id}, ${p.budget})">Re-request Revision</button>
          </div>`;
      } else if (p.status === 'in development' || p.status === 'completed') {
        actionBtn = `<button class="btn btn-secondary" style="border-color:var(--color-primary); color:#fff" onclick="openProjectManagementDetails(${p.id})">Manage Tasks</button>`;
      } else {
        actionBtn = `<button class="btn btn-secondary" style="border-color:var(--color-primary); color:#fff" onclick="openProjectManagementDetails(${p.id})">Manage Tasks</button>`;
      }

      const slots = p.team_slots || 4;
      const projectMeta = p.project_type === 'big' ? `<div style="font-size:0.82rem; margin-top:0.25rem; color:var(--text-muted);">Interest: ${p.interest_count || 0}/${slots} · Team: ${p.team_size || 0}/${slots}</div>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.title}</strong>${projectMeta}</td>
        <td>${p.company_name || p.client_name}</td>
        <td>₹${p.budget.toLocaleString('en-IN')}</td>
        <td>${p.deadline}</td>
        <td><span class="status-badge ${p.status.replace(' ', '-')}">${p.status}</span></td>
        <td>${actionBtn}</td>
      `;
      tbody.appendChild(tr);
    });

    if (cachedProjects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">No projects submitted yet on the platform.</td></tr>`;
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
  }
}

// Switch back to projects list
function backToProjectsList() {
  document.getElementById('project-list-panel').style.display = 'block';
  document.getElementById('project-splitting-panel').style.display = 'none';
  loadProjectsBoard();
}

// AI Project Splitting Wizard
function openProjectSplitWizard(projectId) {
  const p = cachedProjects.find(item => item.id === projectId);
  if (!p) return;

  document.getElementById('split-project-id').value = p.id;
  document.getElementById('split-project-title').innerText = p.title;
  document.getElementById('split-project-desc').innerText = p.description;
  document.getElementById('split-project-budget').innerText = `₹${p.budget.toLocaleString('en-IN')}`;
  document.getElementById('split-project-deadline').innerText = p.deadline;
  
  if (document.getElementById('split-team-slots')) {
    document.getElementById('split-team-slots').value = p.team_slots || 4;
  }

  const container = document.getElementById('split-tasks-container');
  container.innerHTML = '';

  // Extract suggestions generated by local AI analyzer upon project creation
  const analysis = JSON.parse(p.ai_analysis || '{}');
  const suggestions = analysis.suggestedTasks || [];

  renderSplitAnalysisSummary(analysis);

  suggestions.forEach((task, idx) => {
    addTaskRow(task.title, task.description, task.payment_amount, task.deadline, task.working_time || '20 hours');
  });

  if (suggestions.length === 0) {
    // Add one default blank row
    addTaskRow('', '', Math.round(p.budget), p.deadline, '20 hours');
  }

  // Switch panels
  document.getElementById('project-list-panel').style.display = 'none';
  document.getElementById('project-splitting-panel').style.display = 'block';
}

function addTaskRow(title = '', desc = '', budget = 0, deadline = '', workingTime = '20 hours') {
  const container = document.getElementById('split-tasks-container');
  const row = document.createElement('div');
  row.className = 'glass-card split-task-row';
  row.style.background = 'rgba(255,255,255,0.02)';
  row.style.padding = '1.5rem';

  row.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:1rem">
      <strong style="color:var(--color-primary)">Task Milestone #<span class="row-num">${container.children.length + 1}</span></strong>
      <button type="button" class="logout-btn" onclick="this.closest('.split-task-row').remove(); renumberTaskRows()" style="padding:0.25rem 0.5rem" title="Remove Task">&times; Remove</button>
    </div>
    <div class="form-group">
      <label>Task Title</label>
      <input type="text" class="task-title-input" required placeholder="Frontend Layout Integration" value="${title}">
    </div>
    <div class="form-group">
      <label>Task Description / Scope</label>
      <textarea class="task-desc-input" rows="2" placeholder="Describe specific deliverable requirements..." required>${desc}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Payment Release Amount (INR)</label>
        <input type="number" class="task-budget-input" required min="500" value="${budget}" oninput="verifyEscrowSplitsLimit()">
      </div>
      <div class="form-group">
        <label>Estimated Working Hours</label>
        <input type="text" class="task-working-time-input" required value="${workingTime}" placeholder="e.g. 20 hours">
      </div>
      <div class="form-group">
        <label>Task Deadline</label>
        <input type="date" class="task-deadline-input" required value="${deadline}">
      </div>
    </div>
  `;
  container.appendChild(row);
}

function addSplitTaskRow() {
  const budget = document.getElementById('split-tasks-container').children.length === 0 ? 5000 : 2500;
  const deadline = document.getElementById('split-project-deadline').innerText;
  addTaskRow('', '', budget, deadline, '20 hours');
}

function renumberTaskRows() {
  const rows = document.querySelectorAll('.split-task-row');
  rows.forEach((row, idx) => {
    row.querySelector('.row-num').innerText = idx + 1;
  });
  verifyEscrowSplitsLimit();
}

function verifyEscrowSplitsLimit() {
  const budgetStr = document.getElementById('split-project-budget').innerText.replace('₹', '').replace(/,/g, '');
  const totalLimit = parseFloat(budgetStr) || 0;

  const budgetInputs = document.querySelectorAll('.task-budget-input');
  let currentSum = 0;
  budgetInputs.forEach(input => {
    currentSum += parseFloat(input.value) || 0;
  });

  if (currentSum > totalLimit) {
    showToast(`Warning: Sum of task budgets (₹${currentSum}) exceeds client project budget (₹${totalLimit})`, 'warning');
  }
}

// Submit Split Tasks
document.getElementById('project-split-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const projectId = document.getElementById('split-project-id').value;
  const rows = document.querySelectorAll('.split-task-row');
  const tasks = [];

  rows.forEach(row => {
    tasks.push({
      title: row.querySelector('.task-title-input').value,
      description: row.querySelector('.task-desc-input').value,
      payment_amount: parseFloat(row.querySelector('.task-budget-input').value),
      working_time: row.querySelector('.task-working-time-input').value,
      deadline: row.querySelector('.task-deadline-input').value
    });
  });

  const team_slots = document.getElementById('split-team-slots') ? parseInt(document.getElementById('split-team-slots').value) : 4;

  try {
    const response = await fetch(`/api/admin/projects/${projectId}/split`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ tasks, team_slots })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    backToProjectsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// View Manage Tasks view (for assignment and tracking)
function openProjectManagementDetails(projectId) {
  const p = cachedProjects.find(item => item.id === projectId);
  if (!p) return;

  const title = document.getElementById('view-title');
  const subtitle = document.getElementById('view-subtitle');
  title.innerText = p.title;
  subtitle.innerText = `Manage tasks allocation and monitor developer progress. Project Status: ${p.status}`;

  const panel = document.getElementById('project-splitting-panel');
  panel.style.display = 'block';
  document.getElementById('project-list-panel').style.display = 'none';

  document.getElementById('split-project-id').value = p.id;
  document.getElementById('split-project-title').innerText = p.title;
  document.getElementById('split-project-desc').innerText = p.description;
  document.getElementById('split-project-budget').innerText = `₹${p.budget.toLocaleString('en-IN')}`;
  document.getElementById('split-project-deadline').innerText = p.deadline;

  const container = document.getElementById('split-tasks-container');
  container.innerHTML = '<h4>Allocated Tasks</h4><div style="display:flex; flex-direction:column; gap:1rem">';

  // Render project tasks with manual assignment button or claim states
  p.tasks.forEach(t => {
    let assignBtnHTML = '';
    if (!t.assigned_worker_id) {
      assignBtnHTML = `<button type="button" class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.8rem" onclick="openAssignTaskModal(${t.id})">Assign Worker</button>`;
    } else {
      let removeBtn = '';
      if (t.status !== 'completed') {
        removeBtn = `<button type="button" class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff; padding:0.25rem 0.5rem; font-size:0.75rem; margin-left:0.5rem;" onclick="unassignTaskWorker(${t.id})">Remove</button>`;
      }
      assignBtnHTML = `<div style="font-size:0.8rem; color:var(--text-muted); display:flex; align-items:center;">Assigned: <strong style="color:#fff; margin-left:0.25rem;">${t.worker_name || 'Vetted Developer'}</strong>${removeBtn}</div>`;
    }

    const item = document.createElement('div');
    item.className = 'glass-card';
    item.style.background = 'rgba(255,255,255,0.01)';
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
        <strong>${t.title}</strong>
        <span class="status-badge ${t.status.replace(' ', '-')}">${t.status}</span>
      </div>
      <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.75rem">${t.description || 'No description'}</p>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text-muted)">
        <div>Compensation: <strong style="color:var(--color-secondary)">₹${t.payment_amount.toLocaleString('en-IN')}</strong></div>
        <div>Deadline: <strong>${t.deadline}</strong></div>
        ${assignBtnHTML}
      </div>
    `;
    container.appendChild(item);
  });
  
  // Hide split approval submit button for already-approved projects
  document.getElementById('project-split-form').querySelector('button[type="submit"]').style.display = 'none';
}

function renderSplitAnalysisSummary(analysis) {
  const techEl = document.getElementById('analysis-tech');
  const costEl = document.getElementById('analysis-cost');
  const timelineEl = document.getElementById('analysis-timeline');
  const workersEl = document.getElementById('analysis-workers');

  if (!analysis || Object.keys(analysis).length === 0) {
    techEl.innerText = 'No AI analysis available for this project yet.';
    costEl.innerText = '';
    timelineEl.innerText = '';
    workersEl.innerText = '';
    return;
  }

  techEl.innerHTML = `<strong>Suggested Tech:</strong> ${analysis.suggestedTech || 'Not available'}`;
  costEl.innerHTML = `<strong>Suggested Cost:</strong> ₹${(analysis.suggestedCost || 0).toLocaleString('en-IN')}`;
  timelineEl.innerHTML = `<strong>Suggested Timeline:</strong> ${analysis.suggestedWeeks || 'N/A'} weeks`;
  workersEl.innerHTML = `<strong>Suggested Developers:</strong> ${analysis.suggestedWorkers || 'N/A'}`;
}

// ------------------------------------------
// VIEW 3.1: ASSIGN TASK MODAL
// ------------------------------------------
async function openAssignTaskModal(taskId) {
  document.getElementById('assign-task-id').value = taskId;
  const select = document.getElementById('assign-worker-select');
  select.innerHTML = '<option value="">Loading workers...</option>';

  document.getElementById('task-assign-modal').classList.add('active');

  try {
    const response = await fetch('/api/admin/workers/approved', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    select.innerHTML = '<option value="">-- Choose Vetted Developer --</option>';
    data.workers.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      const expLabel = w.experience ? ` · ${w.experience}` : '';
      opt.innerText = `${w.name} (${w.skills || 'General Dev'}${expLabel})`;
      select.appendChild(opt);
    });

  } catch (err) {
    select.innerHTML = `<option value="">Error loading: ${err.message}</option>`;
  }
}

function closeAssignModal() {
  document.getElementById('task-assign-modal').classList.remove('active');
}
// Budget Revision Modal Functions
function openBudgetRevisionModal(projectId, currentBudget) {
  document.getElementById('revision-project-id').value = projectId;
  const budgetInput = document.getElementById('revision-requested-budget');
  if (budgetInput) {
    budgetInput.value = currentBudget;
  }
  const msgInput = document.getElementById('revision-message');
  if (msgInput) {
    msgInput.value = `The proposed budget of ₹${currentBudget.toLocaleString('en-IN')} is insufficient for this project's technical scope. Please revise the budget to proceed with active developer allocation.`;
  }
  document.getElementById('budget-revision-modal').classList.add('active');
}

function closeBudgetRevisionModal() {
  document.getElementById('budget-revision-modal').classList.remove('active');
}

// Handle budget revision form submission
document.getElementById('budget-revision-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const projectId = document.getElementById('revision-project-id').value;
  const newBudget = document.getElementById('revision-requested-budget').value;
  const message = document.getElementById('revision-message').value;
  try {
    const response = await fetch(`/api/admin/projects/${projectId}/request-revision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ requestedBudget: parseFloat(newBudget), message })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    closeBudgetRevisionModal();
    loadProjectsBoard();
  } catch (err) {
    showToast(err.message, 'error');
  }
});
document.getElementById('task-assign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const taskId = document.getElementById('assign-task-id').value;
  const workerId = document.getElementById('assign-worker-select').value;

  try {
    const response = await fetch(`/api/admin/tasks/${taskId}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ workerId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    closeAssignModal();
    
    // Refresh active details
    const projId = document.getElementById('split-project-id').value;
    // Reload projects board array first then open details
    const ref = await fetch('/api/admin/projects', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const refD = await ref.json();
    cachedProjects = refD.projects;
    openProjectManagementDetails(parseInt(projId));

  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ------------------------------------------
// VIEW 4: PAYMENT CONTROL & WORK REVIEW
// ------------------------------------------
// ------------------------------------------
// VIEW 4: PAYMENT INFRASTRUCTURE
// ------------------------------------------

function switchPaymentTab(tab) {
  document.querySelectorAll('.payment-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.payment-tab-btn').forEach(el => el.classList.remove('active', 'btn-primary'));
  document.querySelectorAll('.payment-tab-btn').forEach(el => el.classList.add('btn-secondary'));
  document.getElementById(tab).style.display = '';
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) {
    activeBtn.classList.remove('btn-secondary');
    activeBtn.classList.add('btn-primary', 'active');
  }
}

async function loadPaymentControl() {
  // Load all sub-sections in parallel
  loadPaymentSummary();
  loadPaymentQueue();
  loadWorkerWallets();
  loadWithdrawalRequests();
  loadPayoutHistory();
  loadFinancialAuditTrail();
}

async function loadPaymentSummary() {
  try {
    const [walletRes, queueRes, withdrawalRes] = await Promise.all([
      fetch('/api/admin/payment/wallets', { headers: { 'Authorization': `Bearer ${getToken()}` } }),
      fetch('/api/admin/payment/queue', { headers: { 'Authorization': `Bearer ${getToken()}` } }),
      fetch('/api/admin/payment/withdrawals', { headers: { 'Authorization': `Bearer ${getToken()}` } })
    ]);
    const walletData = await walletRes.json();
    const queueData = await queueRes.json();
    const withdrawalData = await withdrawalRes.json();
    if (walletData.success) {
      document.getElementById('platform-balance').textContent = `₹${(walletData.platformBalance || 0).toLocaleString('en-IN')}`;
      document.getElementById('total-worker-balance').textContent = `₹${(walletData.totalWorkerBalance || 0).toLocaleString('en-IN')}`;
    }
    if (queueData.success) {
      document.getElementById('payment-queue-count').textContent = (queueData.tasks || []).length;
    }
    if (withdrawalData.success) {
      const pending = (withdrawalData.requests || []).filter(r => r.status === 'pending').length;
      document.getElementById('pending-withdrawals-count').textContent = pending;
    }
  } catch (e) { /* non-critical */ }
}

async function loadPaymentQueue() {
  const tbody = document.getElementById('payment-queue-tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/payment/queue', { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.tasks.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">✅ No tasks awaiting payment release.</td></tr>';
      return;
    }
    tbody.innerHTML = data.tasks.map(t => `
      <tr>
        <td><strong>${t.project_title}</strong></td>
        <td>${t.title}</td>
        <td>${t.worker_name || '—'}<br><small style="color:var(--text-muted)">${t.worker_email || ''}</small></td>
        <td><strong>₹${(t.payment_amount || 0).toLocaleString('en-IN')}</strong></td>
        <td>
          <button class="btn btn-primary" style="font-size:0.8rem;padding:0.3rem 0.7rem;"
            onclick="openPaymentReleaseModal(${t.id}, '${(t.title||'').replace(/'/g,"\\'")}', '${(t.worker_name||'Developer').replace(/'/g,"\\'")}', ${t.payment_amount})">
            💰 Release Payment
          </button>
          <button class="btn btn-secondary" style="font-size:0.8rem;padding:0.3rem 0.7rem;margin-left:4px;"
            onclick="rejectTaskSubmission(${t.id})">
            ✖ Reject
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#ef4444;text-align:center">${e.message}</td></tr>`;
  }
}

async function loadWorkerWallets() {
  const tbody = document.getElementById('wallets-tbody');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/payment/wallets', { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.workerWallets.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No worker wallets yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.workerWallets.map(w => `
      <tr>
        <td>${w.name}</td>
        <td>${w.email}</td>
        <td><strong>₹${(w.balance || 0).toLocaleString('en-IN')}</strong></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#ef4444;text-align:center">${e.message}</td></tr>`;
  }
}

async function loadWithdrawalRequests() {
  const tbody = document.getElementById('withdrawals-tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/payment/withdrawals', { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.requests.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No withdrawal requests.</td></tr>';
      return;
    }
    tbody.innerHTML = data.requests.map(r => {
      const statusColor = r.status === 'approved' ? 'var(--status-completed)' : r.status === 'rejected' ? '#ef4444' : 'var(--status-review)';
      let actions = '';
      if (r.status === 'pending') {
        actions = `
          <button class="btn btn-primary" style="font-size:0.75rem;padding:0.25rem 0.6rem" onclick="approveWithdrawal(${r.id})">✔ Approve</button>
          <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.6rem;margin-left:3px" onclick="rejectWithdrawal(${r.id})">✖ Reject</button>
        `;
      } else {
        actions = `<span style="color:${statusColor};font-size:0.85rem">${r.status.toUpperCase()}</span>`;
      }
      return `
        <tr>
          <td>${r.worker_name}<br><small style="color:var(--text-muted)">${r.worker_email}</small></td>
          <td><strong>₹${(r.amount || 0).toLocaleString('en-IN')}</strong></td>
          <td><span style="color:${statusColor}">${r.status}</span></td>
          <td style="font-size:0.8rem">${new Date(r.created_at).toLocaleDateString('en-IN')}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#ef4444;text-align:center">${e.message}</td></tr>`;
  }
}

async function loadPayoutHistory() {
  const tbody = document.getElementById('payouts-tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/payment/payouts', { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.payouts.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No payouts yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.payouts.map(p => `
      <tr>
        <td>${p.worker_name}<br><small style="color:var(--text-muted)">${p.worker_email}</small></td>
        <td>${p.task_title || '—'}</td>
        <td><strong style="color:var(--status-completed)">₹${(p.amount || 0).toLocaleString('en-IN')}</strong></td>
        <td>${p.released_by_name || 'Admin'}</td>
        <td style="font-size:0.8rem">${new Date(p.created_at).toLocaleDateString('en-IN')}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#ef4444;text-align:center">${e.message}</td></tr>`;
  }
}

async function loadFinancialAuditTrail() {
  const tbody = document.getElementById('audit-trail-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading...</td></tr>';
  try {
    const res = await fetch('/api/admin/payment/audit-trail', { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.trail.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No audit events yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.trail.map(e => {
      const eventColors = {
        task_payment_released: 'var(--status-completed)',
        project_funded: '#6366f1',
        withdrawal_requested: '#f59e0b',
        withdrawal_approved: 'var(--status-completed)',
        withdrawal_rejected: '#ef4444'
      };
      const color = eventColors[e.event_type] || 'var(--text-muted)';
      const shortChecksum = e.checksum ? e.checksum.substring(0, 12) + '...' : '—';
      return `
        <tr>
          <td><span style="color:${color};font-weight:600;font-size:0.8rem">${e.event_type.replace(/_/g,' ')}</span></td>
          <td>${e.reference_id || '—'}</td>
          <td><strong>₹${(e.amount || 0).toLocaleString('en-IN')}</strong></td>
          <td>${e.actor_name || `ID:${e.actor_id}`}</td>
          <td style="font-size:0.8rem">${new Date(e.created_at).toLocaleString('en-IN')}</td>
          <td style="font-size:0.7rem;font-family:monospace;color:var(--text-muted)" title="${e.checksum}">${shortChecksum}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444;text-align:center">${e.message}</td></tr>`;
  }
}

// Payment Release Modal (reuse existing review modal from old payment code)
function openPaymentReleaseModal(taskId, title, workerName, amount) {
  document.getElementById('review-task-id').value = taskId;
  document.getElementById('review-task-title').innerText = title;
  document.getElementById('review-worker-name').innerText = workerName;
  // Show amount in code content area for reference
  document.getElementById('review-code-content').innerText = `Payment Amount: ₹${(amount || 0).toLocaleString('en-IN')}\n\nConfirm that work has been reviewed and client has approved the delivery before releasing payment.`;
  document.getElementById('reject-feedback-wrap').style.display = 'none';
  document.getElementById('reject-confirm-btn').style.display = 'none';
  document.getElementById('reject-action-btn').style.display = 'block';
  document.getElementById('admin-review-modal').classList.add('active');
}

function openReviewModal(taskId, title, workerName, code) {
  document.getElementById('review-task-id').value = taskId;
  document.getElementById('review-task-title').innerText = title;
  document.getElementById('review-worker-name').innerText = workerName;
  document.getElementById('review-code-content').innerText = code || 'No code logs logged.';
  document.getElementById('reject-feedback-wrap').style.display = 'none';
  document.getElementById('reject-confirm-btn').style.display = 'none';
  document.getElementById('reject-action-btn').style.display = 'block';
  document.getElementById('admin-review-modal').classList.add('active');
}

function closeReviewModal() {
  document.getElementById('admin-review-modal').classList.remove('active');
}

async function releasePayment() {
  const taskId = document.getElementById('review-task-id').value;
  try {
    const response = await fetch(`/api/admin/tasks/${taskId}/approve-payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message || 'Payment released successfully!', 'success');
    closeReviewModal();
    loadPaymentControl();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function rejectTaskSubmission(taskId) {
  const reason = prompt('Enter rejection reason (will be sent back to worker for rework):');
  if (!reason) return;
  try {
    const res = await fetch(`/api/admin/tasks/${taskId}/reject-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    loadPaymentControl();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function toggleRejectReason() {
  document.getElementById('reject-feedback-wrap').style.display = 'block';
  document.getElementById('reject-action-btn').style.display = 'none';
  document.getElementById('reject-confirm-btn').style.display = 'block';
}

async function rejectSubmission() {
  const taskId = document.getElementById('review-task-id').value;
  const reason = document.getElementById('reject-reason').value;
  if (!reason) { showToast('Please provide rejection feedback', 'warning'); return; }
  try {
    const res = await fetch(`/api/admin/tasks/${taskId}/reject-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    closeReviewModal();
    loadPaymentControl();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function approveWithdrawal(requestId) {
  if (!confirm(`Approve withdrawal request #${requestId}? This will debit the worker's wallet.`)) return;
  try {
    const res = await fetch(`/api/admin/payment/withdrawals/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    loadPaymentControl();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function rejectWithdrawal(requestId) {
  const reason = prompt('Reason for rejection:');
  if (!reason) return;
  try {
    const res = await fetch(`/api/admin/payment/withdrawals/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    loadPaymentControl();
  } catch (e) {
    showToast(e.message, 'error');
  }
}



// ------------------------------------------
// VIEW 5: CHAT SUPPORT (WEBSOCKETS)
// ------------------------------------------
async function loadChatSupport() {
  const ul = document.getElementById('chat-contacts-ul');
  ul.innerHTML = '<li style="padding:1.5rem; color:var(--text-muted); text-align:center">Loading chats...</li>';

  try {
    const response = await fetch('/api/messages/contacts', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    ul.innerHTML = '';
    const contacts = data.contacts;

    contacts.forEach(c => {
      const li = document.createElement('li');
      li.className = `contact-item ${currentChatContactId === c.id ? 'active' : ''}`;
      li.onclick = () => selectChatContact(c.id, c.name);
      li.innerHTML = `
        <div class="contact-avatar">${c.name.charAt(0).toUpperCase()}</div>
        <div class="contact-details">
          <div class="contact-name">${c.name}</div>
          <div class="contact-role">${c.role} contact</div>
        </div>
      `;
      ul.appendChild(li);
    });

    if (contacts.length === 0) {
      ul.innerHTML = '<li style="padding:1.5rem; color:var(--text-muted)">No messaging channels open yet.</li>';
    }

    if (currentChatContactId) {
      const activeName = contacts.find(c => c.id === currentChatContactId)?.name || 'User';
      selectChatContact(currentChatContactId, activeName);
    }

  } catch (err) {
    ul.innerHTML = `<li style="padding:1.5rem; color:#ef4444">${err.message}</li>`;
  }
}

async function selectChatContact(contactId, contactName) {
  currentChatContactId = contactId;

  const contacts = document.querySelectorAll('.contact-item');
  contacts.forEach(c => c.classList.remove('active'));
  const index = Array.from(contacts).findIndex(c => c.querySelector('.contact-name').innerText === contactName);
  if (index !== -1) contacts[index].classList.add('active');

  const chatWindow = document.getElementById('chat-window-box');
  chatWindow.innerHTML = `
    <div class="chat-window-header">
      <div class="contact-avatar">${contactName.charAt(0).toUpperCase()}</div>
      <div class="chat-window-name">${contactName}</div>
    </div>
    <div class="chat-messages-container" id="chat-messages-box">
      <p style="color:var(--text-muted); text-align:center">Loading history log...</p>
    </div>
    <div class="chat-input-panel">
      <input type="text" id="chat-input-message" class="chat-input" placeholder="Type message here..." onkeydown="handleChatInputKey(event)">
      <button class="chat-send-btn" onclick="sendChatMessage()">Send</button>
    </div>
  `;

  // Fetch Message history
  try {
    const response = await fetch(`/api/messages/history/${contactId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const container = document.getElementById('chat-messages-box');
    container.innerHTML = '';

    data.history.forEach(m => {
      appendMessageToWindow(m);
    });

    scrollChatToBottom();
    loadUnreadMessagesCount();

  } catch (err) {
    document.getElementById('chat-messages-box').innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
  }
}

function handleChatInputKey(event) {
  if (event.key === 'Enter') {
    sendChatMessage();
  }
}

function sendChatMessage() {
  const input = document.getElementById('chat-input-message');
  const message = input.value.trim();

  if (!message || !currentChatContactId) return;

  const payload = {
    type: 'send_chat',
    data: {
      receiver_id: currentChatContactId,
      message: message
    }
  };

  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify(payload));
    input.value = '';
  } else {
    fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ receiver_id: currentChatContactId, message })
    }).then(r => r.json()).then(res => {
      if (res.success) {
        input.value = '';
        appendMessageToWindow(res.message);
        scrollChatToBottom();
      }
    });
  }
}

// Map to store raw message text for notification card actions (avoids HTML escaping issues)
const _adminNotifMessages = {};

function appendMessageToWindow(msg) {
  const container = document.getElementById('chat-messages-box');
  if (!container) return;

  const isSelf = msg.sender_id === activeUser.id;
  const bubbleWrapper = document.createElement('div');
  const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Detect budget-related system messages and render special cards
  const msgText = msg.message || '';
  const isBudgetRevised = msgText.includes('[BUDGET REVISED');
  const isBudgetRevisionReq = msgText.includes('[BUDGET REVISION REQUEST');
  const isBudgetAccepted = msgText.includes('[BUDGET ACCEPTED');
  const msgKey = `amsg_${msg.id || Date.now()}`;
  _adminNotifMessages[msgKey] = msgText;

  if (isBudgetRevised && !isSelf) {
    // Client sent revised budget → Admin sees it with Accept button
    bubbleWrapper.className = 'chat-notification-card budget-revised-card';
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">💰</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Client Submitted Revised Budget</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-actions">
          <button class="btn btn-primary admin-notif-accept-btn" style="padding:0.35rem 0.9rem; font-size:0.82rem; background:#10b981; border-color:#059669;">
            ✓ Accept Revised Budget
          </button>
        </div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
    setTimeout(() => {
      const acceptBtn = bubbleWrapper.querySelector('.admin-notif-accept-btn');
      if (acceptBtn) acceptBtn.addEventListener('click', () => adminAcceptRevisedBudgetFromChat(acceptBtn, _adminNotifMessages[msgKey]));
    }, 0);
  } else if (isBudgetRevisionReq && isSelf) {
    // Admin sent a revision request — show as notification card (sent side)
    bubbleWrapper.className = 'chat-notification-card budget-request-card sent-notif';
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">⚠️</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Budget Revision Requested from Client</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
  } else if (isBudgetAccepted) {
    bubbleWrapper.className = `chat-notification-card budget-accepted-card ${isSelf ? 'sent-notif' : ''}`;
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">✅</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Budget Accepted</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
  } else {
    bubbleWrapper.className = `chat-bubble-wrapper ${isSelf ? 'sent' : 'received'}`;
    bubbleWrapper.innerHTML = `
      <div class="chat-bubble">
        ${escapeHTML(msg.message)}
      </div>
      <div class="chat-meta">${timeString}</div>
    `;
  }

  container.appendChild(bubbleWrapper);
}


// Admin accepts revised budget directly from chat notification card
async function adminAcceptRevisedBudgetFromChat(btn, msgText) {
  // Try to extract project title to find project ID
  const match = msgText.match(/PROJECT: "([^"]+)"/);
  if (!match) {
    showToast('Could not identify project from message.', 'error');
    return;
  }
  const projectTitle = match[1];
  // Find project in cachedProjects by title (or fetch if not yet loaded)
  let proj = cachedProjects.find(p => p.title === projectTitle);
  if (!proj) {
    try {
      const r = await fetch('/api/admin/projects', { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const d = await r.json();
      cachedProjects = d.projects || [];
      proj = cachedProjects.find(p => p.title === projectTitle);
    } catch(e) { /* ignore */ }
  }
  if (!proj) {
    showToast('Project not found. Please check the Projects board.', 'warning');
    return;
  }
  await adminAcceptRevisedBudget(proj.id, btn);
}

async function adminAcceptRevisedBudget(projectId, btnEl) {
  try {
    const response = await fetch(`/api/admin/projects/${projectId}/accept-revised-budget`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    // Disable the accept button in the chat card if provided
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerText = '✓ Accepted';
      btnEl.style.opacity = '0.6';
    }
    // Refresh projects board if it's visible
    const boardView = document.getElementById('view-project-management');
    if (boardView && boardView.classList.contains('active')) {
      loadProjectsBoard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminRejectRevisedBudget(projectId) {
  const reason = prompt("Please enter the reason for rejecting the revised budget:");
  if (reason === null) return; // Admin cancelled

  try {
    const response = await fetch(`/api/admin/projects/${projectId}/reject-revised-budget`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ reason: reason || 'Budget amount does not match project requirements.' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadProjectsBoard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleIncomingChatMessage(msg) {
  const isBudgetRevised = (msg.message || '').includes('[BUDGET REVISED');
  if (currentChatContactId === msg.sender_id) {
    appendMessageToWindow(msg);
    scrollChatToBottom();
    fetch(`/api/messages/history/${msg.sender_id}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
  } else {
    if (isBudgetRevised) {
      showToast(`💰 Client submitted a revised budget! Check Chat to accept.`, 'info');
      // Also refresh projects if board is visible
      const boardView = document.getElementById('view-project-management');
      if (boardView && boardView.classList.contains('active')) {
        loadProjectsBoard();
      }
    } else {
      showToast(`New support ticket message from client/worker`, 'info');
    }
    loadUnreadMessagesCount();
  }
}

function handleSentMessageConfirm(msg) {
  if (currentChatContactId === msg.receiver_id) {
    appendMessageToWindow(msg);
    scrollChatToBottom();
  }
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages-box');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

async function loadUnreadMessagesCount() {
  try {
    const response = await fetch('/api/messages/unread-count', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    
    const badge = document.getElementById('chat-unread-badge');
    if (data.unreadCount > 0) {
      badge.innerText = data.unreadCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------
// VIEW 6: REPORTS & AUDITS
// ------------------------------------------
async function loadReports() {
  const tbody = document.getElementById('reports-salaries-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Compiling payroll report...</td></tr>';

  try {
    const response = await fetch('/api/admin/reports', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    // Also load analytics for commission card
    try {
      const statsRes = await fetch('/api/admin/analytics', { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const stats = await statsRes.json();
      if (statsRes.ok) {
        const commEl = document.getElementById('report-commission');
        if (commEl) commEl.innerText = `₹${stats.monthlyProfit.toLocaleString('en-IN')}`;
      }
    } catch (e) { /* ignore */ }

    tbody.innerHTML = '';
    data.workersReport.forEach(w => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${w.id}</td>
        <td><strong>${w.name}</strong></td>
        <td>${w.completed_tasks} tasks completed</td>
        <td style="color:var(--color-secondary); font-weight:700">₹${(w.total_earned || 0).toLocaleString('en-IN')}</td>
      `;
      tbody.appendChild(tr);
    });

    if (data.workersReport.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted)">No active payroll disbursements recorded.</td></tr>`;
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
  }
}

async function loadSecurityControl() {
  const whitelistBody = document.getElementById('security-whitelist-body');
  const alertBody = document.getElementById('security-alert-body');
  const auditBody = document.getElementById('security-audit-body');
  const alertCountEl = document.getElementById('security-alert-count');
  const whitelistCountEl = document.getElementById('security-whitelist-count');

  whitelistBody.innerHTML = '<tr><td colspan="3" style="text-align:center">Loading whitelist...</td></tr>';
  alertBody.innerHTML = '<tr><td colspan="4" style="text-align:center">Loading alerts...</td></tr>';
  auditBody.innerHTML = '<tr><td colspan="4" style="text-align:center">Loading audit logs...</td></tr>';

  try {
    const [whitelistRes, alertsRes, auditRes] = await Promise.all([
      fetch('/api/admin/security/whitelist', { headers: { 'Authorization': `Bearer ${getToken()}` } }),
      fetch('/api/admin/security/alerts', { headers: { 'Authorization': `Bearer ${getToken()}` } }),
      fetch('/api/admin/security/logs', { headers: { 'Authorization': `Bearer ${getToken()}` } })
    ]);

    const whitelistData = await whitelistRes.json();
    const alertsData = await alertsRes.json();
    const auditData = await auditRes.json();

    if (!whitelistRes.ok) throw new Error(whitelistData.error || 'Failed to load whitelist');
    if (!alertsRes.ok) throw new Error(alertsData.error || 'Failed to load alerts');
    if (!auditRes.ok) throw new Error(auditData.error || 'Failed to load audit logs');

    const whitelist = whitelistData.whitelist || [];
    const alerts = alertsData.alerts || [];
    const logs = auditData.logs || [];

    whitelistCountEl.innerText = whitelist.length;
    alertCountEl.innerText = alerts.length;

    if (whitelist.length === 0) {
      whitelistBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted)">No IPs currently whitelisted.</td></tr>';
    } else {
      whitelistBody.innerHTML = whitelist.map(item => `
        <tr>
          <td>${item.ip_address}</td>
          <td>${new Date(item.created_at || item.added_at || item.timestamp || Date.now()).toLocaleString('en-IN')}</td>
          <td><button class="btn btn-secondary" style="font-size:0.78rem; padding:0.25rem 0.55rem;" onclick="removeWhitelistIp(${item.id})">Remove</button></td>
        </tr>
      `).join('');
    }

    if (alerts.length === 0) {
      alertBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted)">No security alerts at this time.</td></tr>';
    } else {
      alertBody.innerHTML = alerts.map(alert => `
        <tr>
          <td>${alert.event_type || alert.title || 'Security Event'}</td>
          <td>${alert.source || alert.ip_address || 'Unknown'}</td>
          <td>${(alert.severity || 'medium').toUpperCase()}</td>
          <td>${new Date(alert.created_at || alert.timestamp || Date.now()).toLocaleString('en-IN')}</td>
        </tr>
      `).join('');
    }

    if (logs.length === 0) {
      auditBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted)">No audit events recorded yet.</td></tr>';
    } else {
      auditBody.innerHTML = logs.map(log => `
        <tr>
          <td>${log.event_type || log.action || 'Audit Event'}</td>
          <td>${log.reference_id || log.details || '—'}</td>
          <td>${log.admin_email || log.actor_name || 'Unknown'}</td>
          <td>${new Date(log.created_at || log.timestamp || Date.now()).toLocaleString('en-IN')}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    whitelistBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
    alertBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
    auditBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
  }
}

async function addWhitelistIp() {
  const ipInput = document.getElementById('security-whitelist-input');
  const ip = ipInput.value.trim();
  if (!ip) {
    showToast('Please enter a valid IP address.', 'warning');
    return;
  }
  try {
    const response = await fetch('/api/admin/security/whitelist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ ip })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message || 'IP whitelisted successfully.', 'success');
    ipInput.value = '';
    loadSecurityControl();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeWhitelistIp(id) {
  if (!confirm('Remove this IP address from the admin whitelist?')) return;
  try {
    const response = await fetch(`/api/admin/security/whitelist/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message || 'IP removed from whitelist.', 'success');
    loadSecurityControl();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

// Admin cancel project
async function adminCancelProject(projectId) {
  if (!confirm('Are you sure you want to CANCEL this project? This action cannot be undone.')) return;
  try {
    const response = await fetch(`/api/admin/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message, 'success');
    loadProjectsBoard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
// GROUP MANAGEMENT LOGIC

// Load groups and render table
async function loadGroupsManagement() {
  const tbody = document.getElementById('admin-groups-table-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading groups...</td></tr>';
  try {
    const res = await fetch('/api/worker/groups', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    tbody.innerHTML = '';
    if (data.groups.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No groups created yet.</td></tr>';
      return;
    }
    data.groups.forEach(g => {
      const leader = g.members.find(m => m.is_leader);
      const leaderName = leader ? leader.name : '—';
      const memberCount = g.members.length;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${g.name}</td>
        <td>${g.description || ''}</td>
        <td>${leaderName}</td>
        <td>${memberCount}</td>
        <td>
          <button class="btn btn-primary" style="padding:0.3rem 0.6rem;font-size:0.8rem;" onclick="openCreateGroupModal(${g.id})">Edit</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Open modal for creating or editing a group
async function openCreateGroupModal(groupId = null) {
  // Reset fields
  document.getElementById('group-id').value = groupId || '';
  document.getElementById('group-name-input').value = '';
  document.getElementById('group-desc-input').value = '';
  const leaderSelect = document.getElementById('group-leader-select');
  const membersSelect = document.getElementById('group-members-select');
  leaderSelect.innerHTML = '<option value="">-- Select Leader (Core Member) --</option>';
  membersSelect.innerHTML = '';

  // Load available workers and core members
  try {
    const res = await fetch('/api/admin/workers/approved', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const coreRes = await fetch('/api/admin/core-members', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const coreData = await coreRes.json();
    if (!coreRes.ok) throw new Error(coreData.error);

    // Populate members select
    data.workers.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.innerText = `${w.name} (${w.skills || ''})`;
      membersSelect.appendChild(opt);
    });

    // Populate leaders select (core members only)
    (coreData.core_members || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.worker_id;
      opt.innerText = `⭐ ${c.name} (${c.skills || 'Core Developer'})`;
      leaderSelect.appendChild(opt);
    });

    if (groupId) {
      // Pre‑populate for editing
      const groupsRes = await fetch('/api/worker/groups', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const groupsData = await groupsRes.json();
      const grp = groupsData.groups.find(g => g.id === groupId);
      if (grp) {
        document.getElementById('group-name-input').value = grp.name;
        // select members
        const memberIds = grp.members.map(m => m.id);
        Array.from(membersSelect.options).forEach(o => {
          if (memberIds.includes(parseInt(o.value))) o.selected = true;
        });
        // select leader if present
        const leader = grp.members.find(m => m.is_leader);
        if (leader) leaderSelect.value = leader.id;
      }
    }
    document.getElementById('group-modal-title').innerText = groupId ? 'Edit Group' : 'Create Group';
    document.getElementById('group-modal').classList.add('active');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeGroupModal() {
  document.getElementById('group-modal').classList.remove('active');
}

// Handle form submission for creating/updating a group
document.getElementById('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const groupId = document.getElementById('group-id').value;
  const name = document.getElementById('group-name-input').value.trim();
  const memberSelect = document.getElementById('group-members-select');
  const selectedMemberIds = Array.from(memberSelect.selectedOptions).map(o => parseInt(o.value));
  try {
    let targetGroupId = groupId;
    if (!groupId) {
      // Create new group
      const res = await fetch('/api/worker/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      targetGroupId = data.groupId;
    }
    // Add members (if any)
    if (selectedMemberIds.length > 0) {
      const resMembers = await fetch(`/api/worker/group/${targetGroupId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ workerIds: selectedMemberIds })
      });
      const dataMembers = await resMembers.json();
      if (!resMembers.ok) throw new Error(dataMembers.error);
    }
    showToast('Group saved successfully', 'success');
    closeGroupModal();
    loadGroupsManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Add placeholder for future edit/delete actions
// Filter groups by name
document.getElementById('group-search').addEventListener('input', function (e) {
  const term = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#admin-groups-table-body tr');
  rows.forEach(row => {
    const nameCell = row.cells[0];
    if (nameCell) {
      const matches = nameCell.textContent.toLowerCase().includes(term);
      row.style.display = matches ? '' : 'none';
    }
  });
});

// Initialize group view if needed (e.g., when navigation loads)
function initGroupView() {
  // Currently navigation directly calls loadGroupsManagement()
  // Placeholder for future extensions
}

async function loadLegalManagement() {
  const docsBody = document.getElementById('admin-legal-documents-body');
  const acceptancesBody = document.getElementById('admin-legal-acceptances-body');
  docsBody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading legal documents...</td></tr>';
  acceptancesBody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading acceptance history...</td></tr>';

  try {
    const [docsRes, acceptRes] = await Promise.all([
      fetch('/api/admin/legal/documents', { headers: { 'Authorization': `Bearer ${getToken()}` } }),
      fetch('/api/admin/legal/acceptances', { headers: { 'Authorization': `Bearer ${getToken()}` } })
    ]);

    const docsData = await docsRes.json();
    const acceptData = await acceptRes.json();

    if (!docsRes.ok) throw new Error(docsData.error || 'Failed to load legal documents');
    if (!acceptRes.ok) throw new Error(acceptData.error || 'Failed to load acceptance history');

    const docs = docsData.documents || [];
    const acceptances = acceptData.acceptances || [];

    docsBody.innerHTML = docs.length === 0
      ? '<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No legal documents published yet.</td></tr>'
      : docs.map(doc => `
        <tr>
          <td>${doc.document_type}</td>
          <td>${doc.version}</td>
          <td>${doc.title}</td>
          <td>${doc.active ? 'Yes' : 'No'}</td>
          <td>${new Date(doc.published_at || doc.created_at).toLocaleString('en-IN')}</td>
        </tr>
      `).join('');

    acceptancesBody.innerHTML = acceptances.length === 0
      ? '<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No acceptance records yet.</td></tr>'
      : acceptances.map(item => `
        <tr>
          <td>${item.user_name} (${item.user_email})</td>
          <td>${item.document_type}</td>
          <td>${item.version}</td>
          <td>${new Date(item.accepted_at).toLocaleString('en-IN')}</td>
          <td>${item.ip_address || '—'}</td>
        </tr>
      `).join('');
  } catch (err) {
    docsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
    acceptancesBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
  }
}

function resetLegalForm() {
  document.getElementById('legal-document-form').reset();
}

const legalForm = document.getElementById('legal-document-form');
legalForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const type = document.getElementById('legal-document-type').value;
  const title = document.getElementById('legal-document-title').value.trim();
  const content = document.getElementById('legal-document-content').value.trim();
  const active = document.getElementById('legal-document-active').checked;

  if (!title || !content) {
    showToast('Title and content are required.', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/admin/legal/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ document_type: type, title, content, active })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to publish legal document');

    showToast('Legal document published successfully.', 'success');
    resetLegalForm();
    loadLegalManagement();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function enforceRBAC(role) {
  const allTabs = document.querySelectorAll('.sidebar-menu-item');
  allTabs.forEach(tab => {
    const view = tab.getAttribute('data-view');
    let allowed = false;
    
    if (role === 'super') {
      allowed = true;
    } else if (role === 'finance') {
      allowed = ['dashboard', 'payment-control', 'reports'].includes(view);
    } else if (role === 'project') {
      allowed = ['dashboard', 'manage-workers', 'project-management', 'chat-support', 'manage-groups', 'manage-legal'].includes(view);
    } else if (role === 'security') {
      // Security role sees dashboard & reports since there is no separate security view
      allowed = ['dashboard', 'reports'].includes(view);
    }
    
    if (!allowed) {
      tab.style.display = 'none';
    }
  });

  let defaultView = 'dashboard';
  
  document.querySelectorAll('.sidebar-menu-item').forEach(i => i.classList.remove('active'));
  const activeTab = document.querySelector(`.sidebar-menu-item[data-view="${defaultView}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.style.display = '';
  }
  
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active'));
  const activePanel = document.getElementById(`view-${defaultView}`);
  if (activePanel) {
    activePanel.classList.add('active');
  }
}
