// ==========================================
// DEVFORCE INDIA - WORKER DASHBOARD LOGIC
// ==========================================

let activeUser = null;
let chatSocket = null;
let currentChatContactId = null;
let cachedTrainingModules = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  activeUser = checkAuth(['worker']);
  if (!activeUser) return;

  // Verify approval status with backend to prevent bypasses
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok || (data.user && !data.user.approved)) {
      window.location.href = 'pending-approval.html';
      return;
    }
    // Update local cached name in case changed
    activeUser = data.user;
  } catch(e) {
    window.location.href = 'login.html';
    return;
  }

  // Set Profile labels
  document.getElementById('worker-name-label').innerText = activeUser.name;
  document.getElementById('worker-avatar').innerText = activeUser.name.charAt(0).toUpperCase();

  setupNavigation();
  loadDashboardSummary();
  loadUnreadMessagesCount();
  setupSettingsForms();
  loadPerformanceStats(); // Populates initial badges

  // Connect WebSocket for real-time notifications/messages
  chatSocket = connectChatWS(handleIncomingChatMessage, handleSentMessageConfirm);
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
          title.innerText = 'Developer Dashboard';
          subtitle.innerText = 'Monitor active task claims and overall balance';
          loadDashboardSummary();
          break;
        case 'available-tasks':
          title.innerText = 'Available Tasks';
          subtitle.innerText = 'Browse open milestones matching your skillset to claim';
          loadAvailableTasks();
          break;
        case 'assigned-tasks':
          title.innerText = 'Assigned Tasks';
          subtitle.innerText = 'Upload deliverables, update progress, or request assistance';
          loadAssignedTasks();
          break;
        case 'earnings':
          title.innerText = 'Earnings Overview';
          subtitle.innerText = 'Track approved disbursements and monthly balances';
          loadEarningsHistory();
          break;
        case 'performance':
          title.innerText = 'Performance Review';
          subtitle.innerText = 'Check rating scores, code compliance, and earned badges';
          loadPerformanceStats();
          break;
        case 'legal-history':
          title.innerText = 'Legal History';
          subtitle.innerText = 'Review accepted agreements and current policy versions';
          loadLegalHistory();
          break;
        case 'training':
          title.innerText = 'Developer Training Portal';
          subtitle.innerText = 'Complete educational modules to earn badges and unlock tasks';
          loadTrainingPortal();
          break;
        case 'chat-support':
          title.innerText = 'Support Chat';
          subtitle.innerText = 'Message platform administrators regarding task instructions';
          loadChatSupport();
          break;
        case 'settings':
          title.innerText = 'Account Settings';
          subtitle.innerText = 'Configure your developer skills and details';
          loadSettingsForm();
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
    // Fetch Earnings
    const earnRes = await fetch('/api/worker/earnings', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const earnData = await earnRes.json();
    if (!earnRes.ok) throw new Error(earnData.error);

    document.getElementById('stats-total-earnings').innerText = `₹${earnData.totalEarnings.toLocaleString('en-IN')}`;
    document.getElementById('stats-pending-payments').innerText = `₹${earnData.pendingPayments.toLocaleString('en-IN')}`;

    // Fetch Assigned Tasks (and count completed ones)
    const taskRes = await fetch('/api/tasks/assigned', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const taskData = await taskRes.json();
    if (!taskRes.ok) throw new Error(taskData.error);

    const tasks = taskData.tasks;
    let completedCount = 0;
    tasks.forEach(t => {
      if (t.status === 'completed') completedCount++;
    });

    document.getElementById('stats-completed-tasks').innerText = completedCount;

    // Render assigned tasks grid briefly
    const grid = document.getElementById('dashboard-assigned-tasks-grid');
    grid.innerHTML = '';
    
    // Display top 3 active
    let activeTasks = tasks.filter(t => t.status !== 'completed').slice(0, 3);
    activeTasks.forEach(t => {
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem">
          <strong style="color:#fff">${t.title}</strong>
          <span class="status-badge ${t.status.replace(' ', '-')}">${t.status}</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:1rem">${t.project_title}</p>
        <div style="font-size:0.8rem; margin-bottom:1rem">Deadline: <span style="color:#fff">${t.deadline}</span></div>
        <div style="display:flex; gap:0.5rem">
          <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem" onclick="openSubmitModal(${t.id}, '${t.title}')">Submit Deliverable</button>
        </div>
      `;
      grid.appendChild(card);
    });

    if (activeTasks.length === 0) {
      grid.innerHTML = `<div style="grid-column:span 3; text-align:center; color:var(--text-muted)">No active claimed tasks. Go to 'Available Tasks' to claim milestones.</div>`;
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 2: AVAILABLE TASKS BOARD
// ---------------------------------------// Globals to store loaded available listings for details navigation
let cachedAvailableBigProjects = [];
let currentActiveTab = 'small'; // default tab

function switchAvailableTasksTab(tab) {
  currentActiveTab = tab;
  const smallBtn = document.getElementById('btn-show-small-tasks');
  const bigBtn = document.getElementById('btn-show-big-projects');
  const smallContainer = document.getElementById('available-small-tasks-container');
  const bigContainer = document.getElementById('available-big-projects-container');

  if (tab === 'small') {
    smallBtn.style.background = 'var(--grad-primary)';
    smallBtn.style.borderColor = 'transparent';
    smallBtn.style.color = '#fff';

    bigBtn.style.background = 'transparent';
    bigBtn.style.borderColor = 'var(--border-color)';
    bigBtn.style.color = 'var(--text-secondary)';

    smallContainer.style.display = 'grid';
    bigContainer.style.display = 'none';
  } else {
    bigBtn.style.background = 'var(--grad-primary)';
    bigBtn.style.borderColor = 'transparent';
    bigBtn.style.color = '#fff';

    smallBtn.style.background = 'transparent';
    smallBtn.style.borderColor = 'var(--border-color)';
    smallBtn.style.color = 'var(--text-secondary)';

    smallContainer.style.display = 'none';
    bigContainer.style.display = 'grid';
  }
}

function backToAvailableTasksBoard() {
  document.getElementById('available-tasks-board-panel').style.display = 'block';
  document.getElementById('available-project-details-panel').style.display = 'none';
  loadAvailableTasks();
}

async function loadAvailableTasks() {
  const smallContainer = document.getElementById('available-small-tasks-container');
  const bigContainer = document.getElementById('available-big-projects-container');
  
  smallContainer.innerHTML = '<p style="color:var(--text-muted)">Loading available listings...</p>';
  bigContainer.innerHTML = '<p style="color:var(--text-muted)">Loading available listings...</p>';

  try {
    const response = await fetch('/api/tasks/available', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    smallContainer.innerHTML = '';
    bigContainer.innerHTML = '';

    const smallTasks = data.small || [];
    cachedAvailableBigProjects = data.big_projects || [];

    // Render Small Tasks
    if (smallTasks.length === 0) {
      smallContainer.innerHTML = `
        <div class="glass-card" style="grid-column: span 3; text-align:center; padding:3rem">
          <p style="color:var(--text-secondary)">No small projects available currently.</p>
        </div>
      `;
    } else {
      smallTasks.forEach(t => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem">
            <div>
              <h3 style="font-size:1.15rem; margin-bottom:0.25rem">${t.title}</h3>
              <span style="font-size:0.8rem; color:var(--text-muted)">Proj: ${t.project_title}</span>
            </div>
            <span class="status-badge" style="background:rgba(16,185,129,0.2); color:#10b981; border-color:#10b981;">Small Project</span>
          </div>
          <p class="card-text" style="font-size:0.9rem; margin-bottom:1.5rem">${t.description || 'No specific descriptions provided'}</p>
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:1.5rem; color:var(--text-secondary)">
            <div>Compensation: <strong style="color:var(--color-secondary)">₹${t.payment_amount.toLocaleString('en-IN')}</strong></div>
            <div>Deadline: <strong style="color:#fff">${t.deadline}</strong></div>
          </div>
          <button class="btn btn-secondary" style="width:100%" onclick="claimTask(${t.id})">Claim Task</button>
        `;
        smallContainer.appendChild(card);
      });
    }

    // Render Big Projects (Simplified Cards on Board)
    if (cachedAvailableBigProjects.length === 0) {
      bigContainer.innerHTML = `
        <div class="glass-card" style="grid-column: span 3; text-align:center; padding:3rem">
          <p style="color:var(--text-secondary)">No big team projects available currently.</p>
        </div>
      `;
    } else {
      cachedAvailableBigProjects.forEach(proj => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        const slots = proj.team_slots || 4;
        const interestCount = proj.interest_count || 0;
        const currentJoined = proj.status === 'team-assigned' ? proj.team_size : interestCount;
        
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem">
            <div>
              <h3 style="font-size:1.15rem; margin-bottom:0.25rem">${proj.title}</h3>
              <span style="font-size:0.8rem; color:var(--text-muted)">Team Project</span>
            </div>
            <span class="status-badge" style="background:rgba(168,85,247,0.2); color:#a855f7; border-color:#a855f7;">Big Project</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:1.5rem; color:var(--text-secondary)">
            <div>Payout: <strong style="color:var(--color-secondary)">₹${proj.budget.toLocaleString('en-IN')}</strong></div>
            <div>Team Slots: <strong style="color:#a855f7">${currentJoined}/${slots} filled</strong></div>
          </div>
          <button class="btn btn-primary" style="width:100%" onclick="viewAvailableProjectDetails(${proj.id})">🔍 View Details & Roles</button>
        `;
        bigContainer.appendChild(card);
      });
    }

    // Make sure tab status is synced
    switchAvailableTasksTab(currentActiveTab);

  } catch (err) {
    smallContainer.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
    bigContainer.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
  }
}

async function viewAvailableProjectDetails(projId) {
  const proj = cachedAvailableBigProjects.find(p => p.id === projId);
  if (!proj) return;

  const content = document.getElementById('available-project-details-content');
  const slots = proj.team_slots || 4;
  
  // Check membership status
  const isMember = proj.status === 'team-assigned' && proj.available_tasks && proj.available_tasks.length > 0;
  const interested = proj.worker_interested > 0;
  const interestCount = proj.interest_count || 0;
  const currentJoined = proj.status === 'team-assigned' ? proj.team_size : interestCount;
  const teamFull = currentJoined >= slots;

  let interestButton = '';
  if (teamFull && isMember) {
    interestButton = `<span style="color:#10b981; font-weight:600; display:block; padding:1rem; border-radius:8px; background:rgba(16,185,129,0.05); text-align:center;">✓ Team Assigned. Claim your task milestones below.</span>`;
  } else if (teamFull) {
    interestButton = `<span style="color:#f97316; font-weight:600; display:block; padding:1rem; border-radius:8px; background:rgba(249,115,22,0.05); text-align:center;">Team slots already filled.</span>`;
  } else if (interested) {
    interestButton = `<span style="color:#3b82f6; font-weight:600; display:block; padding:1rem; border-radius:8px; background:rgba(59,130,246,0.05); text-align:center;">Interest Registered (${interestCount}/${slots} workers)</span>`;
  } else {
    interestButton = `<button class="btn btn-primary" style="width:100%; font-size:1rem; padding:0.75rem" onclick="expressInterest(${proj.id})">Express Interest (${interestCount}/${slots})</button>`;
  }

  // Spec attachment link
  const specFileHTML = proj.file_url ? `
    <div style="margin-bottom:1.5rem; padding:1rem; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong style="color:#fff; display:block; margin-bottom:0.25rem;">Project Specification Bundle</strong>
        <span style="font-size:0.75rem; color:var(--text-muted)">PDF specifications & layout guidelines uploaded by Client</span>
      </div>
      <a href="${proj.file_url}" target="_blank" class="btn btn-secondary" style="width:auto; padding:0.5rem 1rem;">Download Specification Sheet</a>
    </div>
  ` : '';

  // Roles listing HTML
  let tasksListHTML = '';
  if (proj.available_tasks && proj.available_tasks.length > 0) {
    tasksListHTML = `
      <div style="margin-top:2rem; border-top:1px solid rgba(255,255,255,0.08); padding-top:1.5rem">
        <h4 style="font-size:1.1rem; margin-bottom:1rem; color:#a855f7">Required Engineering Roles & Milestone Tasks</h4>
        <div style="display:flex; flex-direction:column; gap:1rem">
    `;

    proj.available_tasks.forEach(t => {
      let budgetText = '';
      let claimActionHTML = '';

      if (proj.status === 'team-assigned') {
        budgetText = `<div style="color:var(--color-secondary); font-weight:600; font-size:0.95rem">Compensation: ₹${t.payment_amount.toLocaleString('en-IN')}</div>`;
        claimActionHTML = `<button class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.8rem; width:auto;" onclick="claimTask(${t.id})">Claim Task</button>`;
      } else {
        budgetText = `<div style="color:var(--text-muted); font-size:0.8rem; font-style:italic">Compensation: Hidden until team forms</div>`;
      }

      tasksListHTML += `
        <div style="padding:1rem; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; display:flex; justify-content:space-between; align-items:center; gap:1.5rem;">
          <div style="min-width:0; flex:1">
            <div style="font-weight:600; font-size:0.95rem; color:#fff; margin-bottom:0.3rem;">${t.title}</div>
            <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5; margin-bottom:0.5rem;">${t.description || 'No description logged'}</div>
            <div style="display:flex; gap:1.5rem; align-items:center; font-size:0.8rem; color:var(--text-muted)">
              <div>Estimated Working Time: <strong style="color:#fff">${t.working_time || '20 hours'}</strong></div>
              <div>Completion Deadline: <strong style="color:#fff">${t.deadline}</strong></div>
            </div>
          </div>
          <div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; gap:0.5rem; align-items:flex-end;">
            ${budgetText}
            ${claimActionHTML}
          </div>
        </div>
      `;
    });

    tasksListHTML += `
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="glass-card" style="padding: 2.5rem; background: rgba(15,22,41,0.7); border: 1px solid rgba(255,255,255,0.08);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0 0 0.5rem; font-size:1.5rem; color:#fff">${proj.title}</h2>
          <span style="font-size:0.85rem; color:var(--text-muted)">Technologies: <strong style="color:#a855f7">${proj.technologies || 'None specified'}</strong></span>
        </div>
        <span class="status-badge" style="background:rgba(168,85,247,0.2); color:#a855f7; border-color:#a855f7; font-size:0.85rem;">Big Team Project</span>
      </div>

      <p style="font-size:1rem; line-height:1.6; color:var(--text-secondary); margin-bottom:2rem;">${proj.description || 'No project scope description uploaded.'}</p>
      
      ${specFileHTML}

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-bottom:2rem;">
        <div class="glass-card" style="padding:1.25rem; background:rgba(255,255,255,0.015);">
          <strong style="color:var(--text-muted); font-size:0.8rem; display:block; margin-bottom:0.4rem;">TOTAL PROJECT BUDGET</strong>
          <span style="font-size:1.5rem; font-weight:700; color:var(--color-secondary)">₹${proj.budget.toLocaleString('en-IN')}</span>
        </div>
        <div class="glass-card" style="padding:1.25rem; background:rgba(255,255,255,0.015);">
          <strong style="color:var(--text-muted); font-size:0.8rem; display:block; margin-bottom:0.4rem;">TEAM FORMATION PROGRESS</strong>
          <span style="font-size:1.5rem; font-weight:700; color:#a855f7">${currentJoined}/${slots} Slots Joined</span>
        </div>
      </div>

      ${interestButton}
      ${tasksListHTML}
    </div>
  `;

  document.getElementById('available-tasks-board-panel').style.display = 'none';
  document.getElementById('available-project-details-panel').style.display = 'block';
}

async function expressInterest(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}/express-interest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message || 'Interest registered!', 'success');
    
    // Refresh the details card dynamically by updating our big projects array
    const projRes = await fetch('/api/tasks/available', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const projData = await projRes.json();
    if (projRes.ok) {
      cachedAvailableBigProjects = projData.big_projects || [];
      viewAvailableProjectDetails(projectId);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function claimTask(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    loadAvailableTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 3: ASSIGNED TASKS & DELIVERABLE SUBMISSION
// ------------------------------------------
// Globals
let cachedMyGroups = [];
let currentActiveGroupId = null;

function backToAssignedBoard() {
  currentActiveGroupId = null;
  document.getElementById('worker-assigned-board-panel').style.display = 'block';
  document.getElementById('worker-group-workspace-panel').style.display = 'none';
  loadAssignedTasks();
}

async function loadAssignedTasks() {
  const container = document.getElementById('assigned-tasks-container');
  const groupsContainer = document.getElementById('assigned-groups-container');
  
  container.innerHTML = '<p style="color:var(--text-muted)">Loading your active milestones...</p>';
  groupsContainer.innerHTML = '<p style="color:var(--text-muted)">Loading your team workspaces...</p>';

  try {
    // 1. Load claimed milestone tasks
    const tasksRes = await fetch('/api/tasks/assigned', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const tasksData = await tasksRes.json();
    if (!tasksRes.ok) throw new Error(tasksData.error);

    container.innerHTML = '';
    const tasks = tasksData.tasks || [];

    tasks.forEach(t => {
      // Hide buttons if completed
      const isCompleted = t.status === 'completed';
      const isReview = t.status === 'review';
      
      let actionButtons = '';
      if (!isCompleted && !isReview) {
        actionButtons = `
          <div style="display:flex; gap:0.5rem">
            <button class="btn btn-secondary" style="flex:1; padding:0.5rem 1rem; font-size:0.85rem" onclick="openSubmitModal(${t.id}, '${t.title}')">Submit Code</button>
            <button class="btn btn-primary" style="background:#ef4444; flex:1; padding:0.5rem 1rem; font-size:0.85rem" onclick="openHelpModal(${t.id})">Request Help</button>
          </div>
        `;
      } else if (isReview) {
        actionButtons = `<div style="font-size:0.85rem; color:var(--status-testing); font-style:italic">Submitted. Code is currently in review.</div>`;
      } else {
        actionButtons = `<div style="font-size:0.85rem; color:var(--status-completed)">Task successfully completed. Payout released.</div>`;
      }

      // Specification download button
      const specDownloadBtn = t.project_file_url ? `
        <div style="margin-bottom: 1rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.75rem;">
          <a href="${t.project_file_url}" target="_blank" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; width: auto; display: inline-flex; align-items: center; gap: 0.25rem;">
            📁 Download Specification Bundle
          </a>
        </div>
      ` : '';

      const card = document.createElement('div');
      card.className = 'glass-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem">
          <div>
            <h3 style="font-size:1.15rem; margin-bottom:0.25rem">${t.title}</h3>
            <span style="font-size:0.8rem; color:var(--text-muted)">Project: ${t.project_title}</span>
          </div>
          <span class="status-badge ${t.status.replace(' ', '-')}">${t.status}</span>
        </div>
        
        <!-- Project Description & Details inside Assigned Task -->
        <div style="font-size:0.82rem; background:rgba(255,255,255,0.01); border:1px dashed rgba(255,255,255,0.05); border-radius:6px; padding:0.75rem; margin-bottom:1rem; color:var(--text-secondary)">
          <strong style="color:var(--color-primary); font-size:0.8rem; display:block; margin-bottom:0.25rem">Project Details</strong>
          ${t.project_description || 'No project description loaded.'}
        </div>

        <p class="card-text" style="font-size:0.9rem; margin-bottom:1rem"><strong style="color:#fff; font-size:0.8rem; display:block; margin-bottom:0.25rem;">Task Objective:</strong> ${t.description || 'No description logged'}</p>
        
        ${specDownloadBtn}

        <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--text-secondary); margin-bottom:1.5rem">
          <div>Budget: <strong style="color:var(--color-secondary)">₹${t.payment_amount.toLocaleString('en-IN')}</strong></div>
          <div>Deadline: <strong style="color:#fff">${t.deadline}</strong></div>
        </div>
        <div style="margin-bottom: 1.5rem">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:0.25rem">
            <span>Milestone Progress</span>
            <span>${t.progress}%</span>
          </div>
          <div style="width:100%; height:6px; background:rgba(255,255,255,0.05); border-radius:99px; overflow:hidden">
            <div style="width:${t.progress}%; height:100%; background:var(--grad-secondary); border-radius:99px"></div>
          </div>
        </div>
        ${actionButtons}
      `;
      container.appendChild(card);
    });

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="grid-column: span 3; text-align:center; padding:2rem">
          <p style="color:var(--text-secondary)">You haven't claimed any milestone tasks yet. Claim one inside your active team workspaces below!</p>
        </div>
      `;
    }

    // 2. Load active team project groups
    const groupsRes = await fetch('/api/worker/my-groups', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const groupsData = await groupsRes.json();
    if (!groupsRes.ok) throw new Error(groupsData.error);

    groupsContainer.innerHTML = '';
    cachedMyGroups = groupsData.groups || [];

    cachedMyGroups.forEach(g => {
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem">
          <div>
            <h3 style="font-size:1.15rem; margin-bottom:0.25rem">${g.name}</h3>
            <span style="font-size:0.8rem; color:var(--text-muted)">Project: ${g.project_title}</span>
          </div>
          <span class="status-badge" style="background:rgba(168,85,247,0.2); color:#a855f7; border-color:#a855f7;">Team Workspace</span>
        </div>
        <p class="card-text" style="font-size:0.9rem; margin-bottom:1.5rem">${g.project_description || 'No description uploaded.'}</p>
        <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:1.5rem">
          Technologies: <strong style="color:#a855f7">${g.technologies || 'None specified'}</strong>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="openGroupWorkspace(${g.id})">🚀 Enter Team Workspace</button>
      `;
      groupsContainer.appendChild(card);
    });

    if (cachedMyGroups.length === 0) {
      groupsContainer.innerHTML = `
        <div class="glass-card" style="grid-column: span 3; text-align:center; padding:2rem">
          <p style="color:var(--text-secondary)">You are not assigned to any team groups yet. Register interest on Big Projects in the Available Board.</p>
        </div>
      `;
    }

  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
    groupsContainer.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
  }
}

async function openGroupWorkspace(groupId) {
  const g = cachedMyGroups.find(group => group.id === groupId);
  if (!g) return;

  currentActiveGroupId = groupId;
  const panel = document.getElementById('worker-group-workspace-content');

  // Spec sheet download
  const specFileHTML = g.project_file_url ? `
    <div style="margin-bottom:1.5rem; padding:1rem; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong style="color:#fff; display:block; margin-bottom:0.25rem;">Project Specification Bundle</strong>
        <span style="font-size:0.75rem; color:var(--text-muted)">PDF specifications & guidelines uploaded by Client</span>
      </div>
      <a href="${g.project_file_url}" target="_blank" class="btn btn-secondary" style="width:auto; padding:0.5rem 1rem;">Download Specification Sheet</a>
    </div>
  ` : '';

  // Render members (Highlight Core Leader)
  let membersHTML = '';
  g.members.forEach(m => {
    const isLeader = m.is_leader ? '👑 Group Leader' : (m.is_core ? '⭐ Core Developer' : 'Team Member');
    const badgeStyle = m.is_leader 
      ? 'background:rgba(245,158,11,0.2); color:#f59e0b; border-color:#f59e0b;' 
      : (m.is_core ? 'background:rgba(168,85,247,0.2); color:#a855f7; border-color:#a855f7;' : 'background:rgba(255,255,255,0.05); color:var(--text-secondary); border-color:var(--border-color);');

    membersHTML += `
      <div style="padding:0.75rem; background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.04); border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="color:#fff">${m.name}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${m.email}</span>
        </div>
        <span class="status-badge" style="font-size:0.7rem; padding:0.15rem 0.35rem; ${badgeStyle}">${isLeader}</span>
      </div>
    `;
  });

  // Render Milestone tasks (allow members to claim them if unclaimed)
  let tasksHTML = '';
  if (g.tasks && g.tasks.length > 0) {
    tasksHTML = `
      <div style="margin-top:2rem; border-top:1px solid rgba(255,255,255,0.08); padding-top:1.5rem">
        <h4 style="font-size:1.1rem; color:#a855f7; margin-bottom:1rem">Project Milestones & Task Allocations</h4>
        <div style="display:flex; flex-direction:column; gap:0.75rem">
    `;

    g.tasks.forEach(t => {
      let claimButton = '';
      if (!t.assigned_worker_id) {
        claimButton = `<button class="btn btn-secondary" style="padding:0.35rem 0.75rem; font-size:0.75rem; width:auto;" onclick="claimMilestoneTask(${t.id}, ${groupId})">Claim Milestone</button>`;
      } else {
        const isMe = t.assigned_worker_id === activeUser.id;
        claimButton = `<span style="font-size:0.8rem; font-weight:600; color:${isMe ? 'var(--color-primary)' : 'var(--text-muted)'}">${isMe ? '✓ Assigned to You' : `Assigned to ${t.assigned_worker_name}`}</span>`;
      }

      tasksHTML += `
        <div style="padding:1rem; background:rgba(255,255,255,0.015); border:1px solid rgba(255,255,255,0.05); border-radius:8px; display:flex; justify-content:space-between; align-items:center; gap:1.5rem;">
          <div>
            <strong style="color:#fff; font-size:0.9rem;">${t.title}</strong>
            <p style="margin:0.25rem 0; font-size:0.82rem; color:var(--text-secondary);">${t.description || 'No objective description'}</p>
            <div style="display:flex; gap:1.25rem; font-size:0.75rem; color:var(--text-muted); margin-top:0.4rem;">
              <div>Compensation: <strong style="color:var(--color-secondary)">₹${t.payment_amount.toLocaleString('en-IN')}</strong></div>
              <div>Est. Work: <strong style="color:#fff">${t.working_time || '20 hours'}</strong></div>
              <div>Deadline: <strong style="color:#fff">${t.deadline}</strong></div>
            </div>
          </div>
          <div style="flex-shrink:0;">
            ${claimButton}
          </div>
        </div>
      `;
    });
    tasksHTML += '</div></div>';
  }

  // Chat Section HTML
  const chatHTML = `
    <div class="glass-card" style="margin-top:2rem; padding:1.5rem; display:flex; flex-direction:column; gap:1rem; background:rgba(15,22,41,0.5)">
      <h4 style="margin:0; color:#a855f7; display:flex; align-items:center; gap:0.5rem">
        💬 Team Sync Channel
      </h4>
      <div id="group-chat-messages" style="height:250px; overflow-y:auto; border:1px solid var(--border-color); border-radius:8px; padding:1rem; background:rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:0.75rem;">
        <p style="color:var(--text-muted); font-size:0.85rem; font-style:italic">Loading team conversation history...</p>
      </div>
      <form id="group-chat-form" style="display:flex; gap:0.5rem" onsubmit="sendGroupChatMessage(event, ${groupId})">
        <input type="text" id="group-chat-input" placeholder="Type a message to the team..." required style="flex:1; background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.5rem 1rem; border-radius:6px;" />
        <button type="submit" class="btn btn-primary" style="width:auto; padding:0.5rem 1.5rem">Send</button>
      </form>
    </div>
  `;

  panel.innerHTML = `
    <div class="glass-card" style="padding: 2.5rem; background: rgba(15,22,41,0.7); border: 1px solid rgba(255,255,255,0.08);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0 0 0.5rem; font-size:1.5rem; color:#fff">${g.name}</h2>
          <span style="font-size:0.85rem; color:var(--text-muted)">Project: <strong style="color:var(--color-primary)">${g.project_title}</strong></span>
        </div>
        <span class="status-badge" style="background:rgba(168,85,247,0.2); color:#a855f7; border-color:#a855f7; font-size:0.85rem;">Project Workspace</span>
      </div>

      <p style="font-size:1rem; line-height:1.6; color:var(--text-secondary); margin-bottom:2rem;">${g.project_description || 'No project description.'}</p>
      
      ${specFileHTML}

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem; margin-bottom:2rem;">
        <!-- Left Column: Team Members -->
        <div class="glass-card" style="padding:1.25rem; background:rgba(255,255,255,0.015);">
          <h4 style="margin-top:0; margin-bottom:1rem; color:#fff">Team Members</h4>
          <div style="display:flex; flex-direction:column; gap:0.75rem">
            ${membersHTML}
          </div>
        </div>

        <!-- Right Column: Project Payout & Info -->
        <div class="glass-card" style="padding:1.25rem; background:rgba(255,255,255,0.015); display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
          <strong style="color:var(--text-muted); font-size:0.8rem; display:block; margin-bottom:0.4rem;">TOTAL PROJECT BUDGET</strong>
          <span style="font-size:2.25rem; font-weight:700; color:var(--color-secondary)">₹${g.project_budget.toLocaleString('en-IN')}</span>
          <span style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">Group Workspace #${g.id}</span>
        </div>
      </div>

      ${tasksHTML}
      ${chatHTML}
    </div>
  `;

  document.getElementById('worker-assigned-board-panel').style.display = 'none';
  document.getElementById('worker-group-workspace-panel').style.display = 'block';

  // Load chat messages history
  loadGroupChatHistory(groupId);
}

async function claimMilestoneTask(taskId, groupId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    
    // Refresh group workspace info by fetching list again
    const groupsRes = await fetch('/api/worker/my-groups', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const groupsData = await groupsRes.json();
    if (groupsRes.ok) {
      cachedMyGroups = groupsData.groups || [];
      openGroupWorkspace(groupId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadGroupChatHistory(groupId) {
  const container = document.getElementById('group-chat-messages');
  try {
    const response = await fetch(`/api/messages/group/${groupId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    container.innerHTML = '';
    const messages = data.history || [];

    if (messages.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic; text-align:center; margin-top:2rem">No messages in this team room yet. Start the conversation!</p>`;
    } else {
      messages.forEach(m => {
        appendGroupMessageToWindow(m, false);
      });
      scrollGroupChatToBottom();
    }
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:0.85rem">${err.message}</p>`;
  }
}

function appendGroupMessageToWindow(msg, scroll = true) {
  const container = document.getElementById('group-chat-messages');
  if (!container) return;

  // Clear placeholder if it's the first message
  if (container.querySelector('p')) {
    const p = container.querySelector('p');
    if (p.innerText.includes('No messages')) container.innerHTML = '';
  }

  const isMe = msg.sender_id === activeUser.id;
  const timeString = new Date(msg.created_at || msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const bubbleWrapper = document.createElement('div');
  bubbleWrapper.style.cssText = `display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:0.25rem`;

  const senderLabel = isMe ? 'You' : `${msg.sender_name} (${msg.sender_role || 'member'})`;

  bubbleWrapper.innerHTML = `
    <span style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.15rem; margin-left:0.25rem; margin-right:0.25rem;">${senderLabel}</span>
    <div style="max-width:75%; padding:0.6rem 0.9rem; border-radius:12px; font-size:0.85rem; line-height:1.4; word-break:break-word;
                background:${isMe ? 'var(--grad-primary)' : 'rgba(255,255,255,0.06)'};
                color:#fff;
                border:1px solid ${isMe ? 'transparent' : 'rgba(255,255,255,0.08)'};">
      ${msg.message}
    </div>
    <span style="font-size:0.65rem; color:var(--text-muted); margin-top:0.15rem; margin-left:0.25rem; margin-right:0.25rem;">${timeString}</span>
  `;

  container.appendChild(bubbleWrapper);
  if (scroll) scrollGroupChatToBottom();
}

function scrollGroupChatToBottom() {
  const container = document.getElementById('group-chat-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

async function sendGroupChatMessage(event, groupId) {
  event.preventDefault();
  const input = document.getElementById('group-chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';

  // Try sending via WebSocket first
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify({
      type: 'send_group_chat',
      data: { group_id: groupId, message }
    }));
  } else {
    // HTTP Fallback
    try {
      const response = await fetch(`/api/messages/group/${groupId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      appendGroupMessageToWindow({
        ...data.message,
        sender_id: activeUser.id,
        sender_name: activeUser.name,
        sender_role: activeUser.role
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}



// Submit code modal helpers
function openSubmitModal(taskId, taskTitle) {
  document.getElementById('submit-task-id').value = taskId;
  document.getElementById('submit-modal-title').innerText = `Submit: ${taskTitle}`;
  document.getElementById('submit-code').value = '';
  document.getElementById('submit-progress').value = 100;
  document.getElementById('progress-val-indicator').innerText = '100%';
  document.getElementById('task-submit-modal').classList.add('active');
}

function closeSubmitModal() {
  document.getElementById('task-submit-modal').classList.remove('active');
}

document.getElementById('task-submit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const taskId = document.getElementById('submit-task-id').value;
  const code_submission = document.getElementById('submit-code').value;
  const progress = document.getElementById('submit-progress').value;

  try {
    const response = await fetch(`/api/tasks/${taskId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ code_submission, progress })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    closeSubmitModal();
    loadAssignedTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Help modal helpers
function openHelpModal(taskId) {
  document.getElementById('help-task-id').value = taskId;
  document.getElementById('help-message').value = '';
  document.getElementById('task-help-modal').classList.add('active');
}

function closeHelpModal() {
  document.getElementById('task-help-modal').classList.remove('active');
}

document.getElementById('task-help-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const taskId = document.getElementById('help-task-id').value;
  const message = document.getElementById('help-message').value;

  try {
    const response = await fetch(`/api/tasks/${taskId}/help`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    closeHelpModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ------------------------------------------
// VIEW 4: EARNINGS & TRANSACTIONS
// ------------------------------------------
function togglePayoutFields() {
  const method = document.getElementById('payout-method').value;
  const upiFields = document.getElementById('upi-fields');
  const bankFields = document.getElementById('bank-fields');
  if (method === 'upi') {
    upiFields.style.display = '';
    bankFields.style.display = 'none';
  } else {
    upiFields.style.display = 'none';
    bankFields.style.display = '';
  }
}

async function loadEarningsHistory() {
  const tbody = document.getElementById('earnings-table-body');
  const wbody = document.getElementById('withdrawals-table-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading history ledgers...</td></tr>';
  wbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Loading withdrawals...</td></tr>';

  try {
    // 1. Fetch wallet data (balance, payouts, withdrawals)
    const walletRes = await fetch('/api/worker/wallet', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const walletData = await walletRes.json();
    if (!walletRes.ok) throw new Error(walletData.error);

    document.getElementById('wallet-balance-val').innerText = `₹${(walletData.balance || 0).toLocaleString('en-IN')}`;

    // 2. Fetch cumulative earnings summaries
    const earnRes = await fetch('/api/worker/earnings', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const earnData = await earnRes.json();
    if (!earnRes.ok) throw new Error(earnData.error);

    document.getElementById('earnings-approved-val').innerText = `₹${(earnData.totalEarnings || 0).toLocaleString('en-IN')}`;
    document.getElementById('earnings-pending-val').innerText = `₹${(earnData.pendingPayments || 0).toLocaleString('en-IN')}`;

    // 3. Render recent payouts to wallet
    tbody.innerHTML = '';
    if (walletData.payouts && walletData.payouts.length > 0) {
      walletData.payouts.forEach(row => {
        const tr = document.createElement('tr');
        const dateStr = new Date(row.created_at).toLocaleDateString('en-IN');
        tr.innerHTML = `
          <td><strong>—</strong></td>
          <td>${row.task_title || 'Task Payout'}</td>
          <td>₹${(row.amount || 0).toLocaleString('en-IN')}</td>
          <td>${dateStr}</td>
          <td><span class="status-badge completed">Approved</span></td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No payout transactions found. Complete milestones to start earning.</td></tr>`;
    }

    // 4. Render withdrawals
    wbody.innerHTML = '';
    if (walletData.withdrawals && walletData.withdrawals.length > 0) {
      walletData.withdrawals.forEach(w => {
        const tr = document.createElement('tr');
        const dateStr = new Date(w.created_at).toLocaleDateString('en-IN');
        const statusColor = w.status === 'approved' ? 'var(--status-completed)' : w.status === 'rejected' ? '#ef4444' : 'var(--status-review)';
        tr.innerHTML = `
          <td><strong>₹${(w.amount || 0).toLocaleString('en-IN')}</strong></td>
          <td style="font-size:0.8rem">${dateStr}</td>
          <td><span style="color:${statusColor}">${w.status}</span></td>
        `;
        wbody.appendChild(tr);
      });
    } else {
      wbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted)">No withdrawals requested yet.</td></tr>`;
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
    wbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#ef4444">${err.message}</td></tr>`;
  }
}

// Setup withdrawal form submission handler
document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'withdraw-form') {
    e.preventDefault();
    const amount = Number(document.getElementById('withdraw-amount').value);
    const method = document.getElementById('payout-method').value;
    const upi_id = document.getElementById('withdraw-upi').value;
    const bank_account = document.getElementById('withdraw-bank-account').value;
    const ifsc = document.getElementById('withdraw-bank-ifsc').value;
    const account_name = document.getElementById('withdraw-bank-name').value;

    const bodyData = { amount };
    if (method === 'upi') {
      if (!upi_id) {
        showToast('Please enter your UPI ID', 'warning');
        return;
      }
      bodyData.upi_id = upi_id;
    } else {
      if (!bank_account || !ifsc || !account_name) {
        showToast('Please fill out all bank account details', 'warning');
        return;
      }
      bodyData.bank_account = bank_account;
      bodyData.ifsc = ifsc;
      bodyData.account_name = account_name;
    }

    try {
      const res = await fetch('/api/worker/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(bodyData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(data.message, 'success');
      document.getElementById('withdraw-amount').value = '';
      loadEarningsHistory();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});


// ------------------------------------------
// VIEW 5: PERFORMANCE & BADGES
// ------------------------------------------
async function loadPerformanceStats() {
  try {
    const response = await fetch('/api/worker/performance', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    document.getElementById('perf-rating').innerText = data.rating;
    document.getElementById('perf-accuracy').innerText = `${data.accuracyScore}%`;

    // Highlight completed training modules badges
    const trainRes = await fetch('/api/worker/training', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const trainData = await trainRes.json();
    if (!trainRes.ok) throw new Error(trainData.error);

    trainData.modules.forEach(m => {
      // Re-map string spaces/dots to match CSS IDs
      const badgeId = `badge-${m.module_type.replace(' ', '_').replace('.', '_')}`;
      const badgeEl = document.getElementById(badgeId);
      if (badgeEl) {
        if (m.badge_awarded === 1) {
          badgeEl.classList.add('active');
        } else {
          badgeEl.classList.remove('active');
        }
      }
    });

  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------
// VIEW 6: TRAINING VIDEOS & QUIZ
// ------------------------------------------
async function loadTrainingPortal() {
  const grid = document.getElementById('training-modules-grid');
  grid.innerHTML = '<p style="color:var(--text-muted); grid-column:span 3; text-align:center">Loading training curriculum...</p>';

  try {
    const response = await fetch('/api/worker/training', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    grid.innerHTML = '';
    cachedTrainingModules = data.modules;

    data.modules.forEach(m => {
      // Draw training cards
      const statusPill = m.completed === 1 
        ? `<span class="status-badge completed" style="position:absolute; top:1rem; right:1.5rem">Passed (${m.quiz_score}%)</span>`
        : `<span class="status-badge pending" style="position:absolute; top:1rem; right:1.5rem">Uncompleted</span>`;

      const badgeIndicator = m.badge_awarded === 1 
        ? `<div style="color:var(--status-pending); font-weight:700; font-size:0.75rem; margin-top:0.5rem">🎖️ Badge Unlocked</div>`
        : '';

      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.paddingTop = '3.5rem';
      card.innerHTML = `
        ${statusPill}
        <div class="card-icon" style="background:rgba(16,185,129,0.1); color:var(--color-secondary)">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <h3 class="card-title">${m.title}</h3>
        <p class="card-text" style="font-size:0.85rem; margin-bottom:1.5rem">${m.description}</p>
        <button class="btn btn-primary" style="width:100%" onclick="playTrainingModule(${m.id})">
          ${m.completed === 1 ? 'Review Module' : 'Start Course'}
        </button>
        ${badgeIndicator}
      `;
      grid.appendChild(card);
    });

  } catch (err) {
    grid.innerHTML = `<p style="color:#ef4444; grid-column:span 3">${err.message}</p>`;
  }
}

function playTrainingModule(moduleId) {
  const m = cachedTrainingModules.find(item => item.id === moduleId);
  if (!m) return;

  document.getElementById('training-video-title').innerText = m.title;
  document.getElementById('training-video-desc').innerText = m.description;
  document.getElementById('training-iframe').src = m.video_url;
  document.getElementById('quiz-module-id').value = m.id;

  // Build Quiz HTML
  const quizWrap = document.getElementById('quiz-questions-wrap');
  quizWrap.innerHTML = '';
  
  const questions = JSON.parse(m.quiz_json);
  questions.forEach((q, qIndex) => {
    const qDiv = document.createElement('div');
    qDiv.className = 'quiz-question-item';
    
    let optionsHTML = '';
    q.options.forEach((opt, optIndex) => {
      optionsHTML += `
        <label class="quiz-option">
          <input type="radio" name="question-${qIndex}" value="${optIndex}" required>
          <span>${opt}</span>
        </label>
      `;
    });

    qDiv.innerHTML = `
      <div class="quiz-question-text">${qIndex + 1}. ${q.q}</div>
      <div class="quiz-options-list">
        ${optionsHTML}
      </div>
    `;
    quizWrap.appendChild(qDiv);
  });

  // Switch panels
  document.getElementById('training-list-panel').style.display = 'none';
  document.getElementById('training-player-panel').style.display = 'block';
}

function backToTrainingList() {
  document.getElementById('training-iframe').src = ''; // stop playback
  document.getElementById('training-list-panel').style.display = 'block';
  document.getElementById('training-player-panel').style.display = 'none';
  loadTrainingPortal();
}

// Submit Quiz Form
document.getElementById('training-quiz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const moduleId = document.getElementById('quiz-module-id').value;
  const questions = document.querySelectorAll('.quiz-question-item');
  const answers = [];

  questions.forEach((q, idx) => {
    const selected = document.querySelector(`input[name="question-${idx}"]:checked`);
    answers.push(selected ? parseInt(selected.value) : -1);
  });

  try {
    const response = await fetch(`/api/worker/training/${moduleId}/quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ answers })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    if (data.badgeAwarded) {
      showToast(`Quiz Passed! Badge Unlocked: ${data.score}%`, 'success');
      alert(`🎖️ Badge Unlocked!\n\nExcellent work! You answered ${data.correctAnswers}/${data.totalQuestions} questions correctly.\nYour credential badge is now active on your profile.`);
    } else {
      showToast(`Quiz Failed. Score: ${data.score}%`, 'error');
      alert(`Study Material Review Needed!\n\nYou scored ${data.score}% (${data.correctAnswers}/${data.totalQuestions} correct).\nYou need a minimum score of 80% to earn a developer credential badge. Please review the video tutorial and re-attempt.`);
    }

    backToTrainingList();

  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ------------------------------------------
// VIEW 7: CHAT SUPPORT (WEBSOCKETS)
// ------------------------------------------
async function loadChatSupport() {
  const ul = document.getElementById('chat-contacts-ul');
  ul.innerHTML = '<li style="padding:1.5rem; color:var(--text-muted); text-align:center">Loading administrators...</li>';

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
          <div class="contact-role">Platform ${c.role}</div>
        </div>
      `;
      ul.appendChild(li);
    });

    if (contacts.length === 0) {
      ul.innerHTML = '<li style="padding:1.5rem; color:var(--text-muted)">No administrators logged online.</li>';
    }

    if (currentChatContactId) {
      const activeName = contacts.find(c => c.id === currentChatContactId)?.name || 'Admin';
      selectChatContact(currentChatContactId, activeName);
    }

  } catch (err) {
    ul.innerHTML = `<li style="padding:1.5rem; color:#ef4444">${err.message}</li>`;
  }
}

async function selectChatContact(contactId, contactName) {
  currentChatContactId = contactId;

  // Update contact styles
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
      <p style="color:var(--text-muted); text-align:center">Loading chat records...</p>
    </div>
    <div class="chat-input-panel">
      <input type="text" id="chat-input-message" class="chat-input" placeholder="Type message to administrators..." onkeydown="handleChatInputKey(event)">
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

function appendMessageToWindow(msg) {
  const container = document.getElementById('chat-messages-box');
  if (!container) return;

  const isSelf = msg.sender_id === activeUser.id;
  const bubbleWrapper = document.createElement('div');
  bubbleWrapper.className = `chat-bubble-wrapper ${isSelf ? 'sent' : 'received'}`;
  
  const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  bubbleWrapper.innerHTML = `
    <div class="chat-bubble">
      ${escapeHTML(msg.message)}
    </div>
    <div class="chat-meta">${timeString}</div>
  `;

  container.appendChild(bubbleWrapper);
}

function handleIncomingChatMessage(msg) {
  if (msg.isGroup) {
    if (currentActiveGroupId === msg.group_id) {
      appendGroupMessageToWindow(msg);
    } else {
      showToast(`New message in Team Channel`, 'info');
    }
    return;
  }

  if (currentChatContactId === msg.sender_id) {
    appendMessageToWindow(msg);
    scrollChatToBottom();
    // Hit API to mark as read
    fetch(`/api/messages/history/${msg.sender_id}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
  } else {
    showToast(`New support message received from admin`, 'info');
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
// VIEW 8: SETTINGS FORM MANAGEMENT
// ------------------------------------------
function loadSettingsForm() {
  document.getElementById('profile-name').value = activeUser.name;
  document.getElementById('profile-age').value = activeUser.age || '';
  document.getElementById('profile-hours').value = activeUser.available_hours || '';
  document.getElementById('profile-skills').value = activeUser.skills || '';
  document.getElementById('profile-experience').value = activeUser.experience || '';
}

function setupSettingsForms() {
  const profileForm = document.getElementById('settings-profile-form');
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    activeUser.name = document.getElementById('profile-name').value;
    activeUser.age = parseInt(document.getElementById('profile-age').value);
    activeUser.available_hours = parseInt(document.getElementById('profile-hours').value);
    activeUser.skills = document.getElementById('profile-skills').value;
    activeUser.experience = document.getElementById('profile-experience').value;
    
    setUser(activeUser);
    document.getElementById('worker-name-label').innerText = activeUser.name;
    document.getElementById('worker-avatar').innerText = activeUser.name.charAt(0).toUpperCase();
    
    showToast('Professional skills saved (mocked).', 'success');
  });

  const passForm = document.getElementById('settings-password-form');
  passForm.addEventListener('submit', (e) => {
    e.preventDefault();
    passForm.reset();
    showToast('Your security credentials have been updated.', 'success');
  });
}

async function loadLegalHistory() {
  const latestAcceptedText = document.getElementById('legal-history-latest');
  const currentVersionText = document.getElementById('legal-history-current-version');
  const historyBody = document.getElementById('legal-history-table-body');
  const currentDocsContainer = document.getElementById('legal-current-documents');

  latestAcceptedText.innerText = 'Loading…';
  currentVersionText.innerText = 'Loading…';
  historyBody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading acceptance history...</td></tr>';
  currentDocsContainer.innerHTML = '<p style="color:var(--text-muted);">Loading active legal documents...</p>';

  try {
    const res = await fetch('/api/legal/history', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load legal history');

    const currentDocs = data.currentDocuments || [];
    const history = data.acceptanceHistory || [];
    const latest = history[0];

    latestAcceptedText.innerText = latest
      ? `${latest.document_type.toUpperCase()} v${latest.version} on ${new Date(latest.accepted_at).toLocaleString('en-IN')}`
      : 'No previous acceptances';

    currentVersionText.innerText = currentDocs.length
      ? currentDocs.map(doc => `${doc.document_type.toUpperCase()} v${doc.version}`).join(' • ')
      : 'No active agreements published';

    if (history.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">You have not accepted any agreements yet.</td></tr>';
    } else {
      historyBody.innerHTML = history.map(item => `
        <tr>
          <td>${item.document_title || item.document_type}</td>
          <td>v${item.version}</td>
          <td>${new Date(item.accepted_at).toLocaleString('en-IN')}</td>
          <td>${item.ip_address || '—'}</td>
          <td>${escapeHTML(item.user_agent || '—')}</td>
        </tr>
      `).join('');
    }

    if (currentDocs.length === 0) {
      currentDocsContainer.innerHTML = '<p style="color:var(--text-muted);">No active legal documents are currently published.</p>';
    } else {
      currentDocsContainer.innerHTML = currentDocs.map(doc => `
        <div class="glass-card" style="padding:1rem; background:rgba(255,255,255,0.03);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap;">
            <div>
              <h4 style="margin:0 0 0.35rem 0; color:#fff;">${doc.title} (${doc.document_type.toUpperCase()} v${doc.version})</h4>
              <div style="font-size:0.9rem; color:var(--text-secondary);">Published: ${new Date(doc.published_at || doc.created_at).toLocaleString('en-IN')}</div>
            </div>
            <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:0.5rem;">
              <button class="btn btn-secondary" type="button" onclick="downloadDocumentAsPDF('codifyx-${doc.document_type}-v${doc.version}.pdf', ${JSON.stringify(doc.content)})">Download PDF</button>
              <button class="btn btn-secondary" type="button" onclick="downloadDocumentAsDocx('codifyx-${doc.document_type}-v${doc.version}.docx', ${JSON.stringify(doc.content)})">Download DOCX</button>
            </div>
          </div>
          <details style="margin-top:1rem;">
            <summary style="cursor:pointer; color:#9ca3af;">View document content</summary>
            <div style="margin-top:0.75rem; white-space:pre-wrap; color:#d1d5db;">${escapeHTML(doc.content)}</div>
          </details>
        </div>
      `).join('');
    }
  } catch (err) {
    latestAcceptedText.innerText = 'Unable to load data';
    currentVersionText.innerText = 'Unable to load data';
    historyBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${escapeHTML(err.message)}</td></tr>`;
    currentDocsContainer.innerHTML = `<p style="color:#ef4444;">${escapeHTML(err.message)}</p>`;
  }
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
