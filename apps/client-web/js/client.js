// ==========================================
// DEVFORCE INDIA - CLIENT DASHBOARD LOGIC
// ==========================================

let activeUser = null;
let chatSocket = null;
let currentChatContactId = null;
let clientProjectsCache = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  activeUser = checkAuth(['client']);
  if (!activeUser) return;

  // Set Profile labels
  document.getElementById('client-name-label').innerText = activeUser.name;
  document.getElementById('client-avatar').innerText = activeUser.name.charAt(0).toUpperCase();

  setupNavigation();
  loadDashboardSummary();
  loadUnreadMessagesCount();
  setupSettingsForms();

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
          title.innerText = 'Dashboard Summary';
          subtitle.innerText = 'Review active engineering tasks and budgets';
          loadDashboardSummary();
          break;
        case 'new-project':
          title.innerText = 'Create New Project';
          subtitle.innerText = 'Submit requirements to auto-split and match developers';
          document.getElementById('new-project-form').reset();
          break;
        case 'active-projects':
          title.innerText = 'Active Projects';
          subtitle.innerText = 'Track milestones, tasks completion status, and download code';
          loadClientProjects();
          break;
        case 'payment-history':
          title.innerText = 'Payment History';
          subtitle.innerText = 'Review all transactions and escrow disbursements';
          loadPaymentHistory();
          break;
        case 'legal-history':
          title.innerText = 'Legal History';
          subtitle.innerText = 'View your document acceptance history and current active agreements';
          loadLegalHistory();
          break;
        case 'chat-support':
          title.innerText = 'Chat Support';
          subtitle.innerText = 'Discuss specs and deliverables directly with Admin staff';
          loadChatSupport();
          break;
        case 'settings':
          title.innerText = 'Account Settings';
          subtitle.innerText = 'Manage your profile and authentication settings';
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
    const data = await getClientProjects();
    const projects = data.projects;
    let totalInvested = 0;
    let activeCount = 0;
    let completedTasks = 0;

    const tbody = document.getElementById('recent-projects-table-body');
    tbody.innerHTML = '';

    projects.forEach((proj, idx) => {
      totalInvested += proj.budget;
      if (proj.status === 'in development' || proj.status === 'team-assigned') activeCount++;
      
      // Count completed tasks
      if (proj.tasks) {
        proj.tasks.forEach(t => {
          if (t.status === 'completed') completedTasks++;
        });
      }

      // Display first 5 in recent submissions
      if (idx < 5) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${proj.title}</strong></td>
          <td>₹${proj.budget.toLocaleString('en-IN')}</td>
          <td>${proj.deadline}</td>
          <td><span class="status-badge ${proj.status.replace(' ', '-')}">${proj.status}</span></td>
          <td><button class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.8rem" onclick="viewProjectDetails(${proj.id})">Track</button></td>
        `;
        tbody.appendChild(tr);
      }
    });

    if (!projects || projects.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No projects submitted yet. Go to 'New Project' to submit.</td></tr>`;
    }

    // Set counter cards
    document.getElementById('stats-total-budget').innerText = `₹${totalInvested.toLocaleString('en-IN')}`;
    document.getElementById('stats-active-projects').innerText = activeCount;
    document.getElementById('stats-completed-tasks').innerText = completedTasks;

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 2: CREATE PROJECT & AI ESTIMATOR
// ------------------------------------------
const projFile = document.getElementById('proj-file');
const projFileLabel = document.getElementById('proj-file-label');
if (projFile) {
  projFile.addEventListener('change', () => {
    if (projFile.files.length === 0) {
      projFileLabel.querySelector('span').innerText = 'Choose specification files or a zipped bundle';
      projFileLabel.style.color = 'inherit';
      return;
    }

    if (projFile.files.length === 1) {
      projFileLabel.querySelector('span').innerText = projFile.files[0].name;
    } else {
      projFileLabel.querySelector('span').innerText = `${projFile.files.length} files selected — they will be sent as one bundle`;
    }
    projFileLabel.style.color = '#10b981';
  });
}

async function buildUploadBundle(files) {
  if (!files || files.length === 0) return null;
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return { file: files[0], fileName: files[0].name };
  }
  if (files.length === 1) {
    return { file: files[0], fileName: files[0].name };
  }

  if (typeof JSZip === 'undefined') {
    throw new Error('Bundling library not loaded. Please refresh the page and try again.');
  }

  const zip = new JSZip();
  for (let file of files) {
    zip.file(file.name, file);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  return { file: content, fileName: 'project-bundle.zip' };
}

function normalizeDeadline(rawDate) {
  if (!rawDate) return null;
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  const localPattern = /^\d{2}-\d{2}-\d{4}$/;
  if (isoPattern.test(rawDate)) return rawDate;
  if (localPattern.test(rawDate)) {
    const [day, month, year] = rawDate.split('-');
    const dateObj = new Date(`${year}-${month}-${day}`);
    if (isNaN(dateObj.getTime())) return null;
    return dateObj.toISOString().split('T')[0];
  }
  return null;
}

// Project Submission
const projectForm = document.getElementById('new-project-form');
projectForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('proj-title').value.trim();
  const description = document.getElementById('proj-desc').value.trim();
  const budget = document.getElementById('proj-budget').value.trim();
  let deadline = document.getElementById('proj-deadline').value.trim();
  const technologies = document.getElementById('proj-tech').value.trim();
  const fileField = document.getElementById('proj-file');

  deadline = normalizeDeadline(deadline);
  if (!deadline) {
    showToast('Please enter deadline in DD-MM-YYYY or YYYY-MM-DD format.', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', description);
  formData.append('budget', budget);
  formData.append('deadline', deadline);
  formData.append('technologies', technologies);

  if (fileField.files.length > 0) {
    const bundle = await buildUploadBundle(Array.from(fileField.files));
    formData.append('projectFile', bundle.file, bundle.fileName);
  }

  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast('Project submitted successfully and sent to admin for review.', 'success');
    projectForm.reset();
    
    // Switch to active view
    setTimeout(() => {
      document.querySelector('.sidebar-menu-item[data-view="active-projects"]').click();
    }, 1000);

  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ------------------------------------------
// VIEW 3: ACTIVE PROJECTS TRACKER & DETAILS MODAL
// ------------------------------------------
async function loadClientProjects() {
  const container = document.getElementById('active-projects-container');
  container.innerHTML = '<p style="color:var(--text-muted)">Loading your active workspaces...</p>';

  try {
    const data = await getClientProjects();
    const projects = data.projects;
    container.innerHTML = '';

    projects.forEach(p => {
      // Calculate overall progress based on tasks
      let completedTasksCount = 0;
      let totalTasksCount = p.tasks ? p.tasks.length : 0;
      let progressPercent = 0;

      if (totalTasksCount > 0) {
        p.tasks.forEach(t => {
          if (t.status === 'completed') completedTasksCount++;
        });
        progressPercent = Math.round((completedTasksCount / totalTasksCount) * 100);
      }

      const projectTypeBadge = p.project_type === 'big' ? `<span class="status-badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border-color:#a855f7;">Team Project</span>` : '';
      const teamStatusText = p.project_type === 'big'
        ? (p.status === 'team-assigned'
            ? `Team assigned and development is underway.`
            : `Team formation: ${p.interest_count || 0}/4 interested, ${p.team_size || 0}/4 assigned.`)
        : '';
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.marginBottom = '1.5rem';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem">
          <div>
            <h3 style="margin-bottom:0.25rem">${p.title}</h3>
            <div style="font-size:0.85rem; color:var(--text-secondary)">Technologies: <span style="color:#a855f7">${p.technologies || 'None specified'}</span></div>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:flex-start;">
            ${projectTypeBadge}
            <span class="status-badge ${p.status.replace(' ', '-')}">${p.status}</span>
          </div>
        </div>

        <p class="card-text" style="margin-bottom:1.5rem">${p.description}</p>
        ${teamStatusText ? `<p style="margin-top:0.5rem; color:${p.status === 'team-assigned' ? '#10b981' : '#a855f7'}; font-weight:600">${teamStatusText}</p>` : ''}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem">
          <div style="font-size:0.9rem">Budget: <strong style="color:#fff">₹${p.budget.toLocaleString('en-IN')}</strong></div>
          <div style="font-size:0.9rem">Deadline: <strong style="color:#fff">${p.deadline}</strong></div>
        </div>

        ${p.status === 'pending' ? `<div style="margin-bottom:1.25rem; padding:1rem; border-radius:12px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.15); color:#d1fae5; font-weight:600">Your project has been submitted and is awaiting admin review. You will see status updates here once review begins.</div>` : ''}
        ${p.status === 'revision-requested' ? `
          <div style="margin-bottom:1.25rem; padding:1rem; border-radius:12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); color:#fbbf24; font-weight:600">
            <div style="margin-bottom:0.5rem">Admin requested a budget revision for this project.</div>
            ${p.revision_message ? `<div style="font-size:0.9rem; margin-bottom:0.5rem;color:#f3f4f6;">"${p.revision_message}"</div>` : ''}
            ${p.revision_requested_budget ? `<div style="font-size:0.9rem;color:#10b981;">Requested budget: ₹${parseFloat(p.revision_requested_budget).toLocaleString('en-IN')}</div>` : ''}
          </div>` : ''}

        <!-- Progress bar -->
        <div style="margin-bottom: 1.5rem">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.5rem">
            <span>Overall Development Completion</span>
            <span>${progressPercent}% (${completedTasksCount}/${totalTasksCount} Tasks Completed)</span>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.05); border-radius:99px; overflow:hidden">
            <div style="width:${progressPercent}%; height:100%; background:var(--grad-primary); border-radius:99px"></div>
          </div>
        </div>

        <div style="display:flex; gap:1rem; flex-wrap:wrap">
          <button class="btn btn-primary" onclick="viewProjectDetails(${p.id})">
            Track Milestones &amp; Download Files
          </button>
          ${p.status === 'revision-requested' ? `
            <button class="btn btn-primary" style="background:#10b981; border-color:#059669; color:#fff" onclick="acceptBudgetRevision(${p.id}, true)">
              Accept Revision
            </button>
            <button class="btn btn-secondary" style="background:#f59e0b; border-color:#d97706; color:#fff" onclick="openClientBudgetRevisionModal(${p.id}, ${p.revision_requested_budget || p.budget})">
              Revise Budget
            </button>
            <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff" onclick="acceptBudgetRevision(${p.id}, false)">
              Reject Revision
            </button>
          ` : ''}
          ${p.status === 'pending' ? `
            <button class="btn btn-secondary" style="background:#ef4444; border-color:#dc2626; color:#fff" onclick="cancelClientProject(${p.id})">
              Cancel Project
            </button>
          ` : ''}
        </div>
      `;
      container.appendChild(card);
    });

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="glass-card" style="text-align:center; padding:3rem">
          <p style="color:var(--text-secondary); margin-bottom:1.5rem">No active projects found. Submit a specifications sheet to get started.</p>
          <button class="btn btn-primary" onclick="document.querySelector('.sidebar-menu-item[data-view=\\'new-project\\']').click()">Create New Project</button>
        </div>
      `;
    }

  } catch (err) {
    const message = err.message || 'Unable to load active projects. Please try again in a moment.';
    container.innerHTML = `<p style="color:#ef4444">${message}</p>`;
  }
}

async function getClientProjects() {
  if (clientProjectsCache) {
    return clientProjectsCache;
  }

  const response = await fetch('/api/projects/client', {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  clientProjectsCache = data;
  return data;
}

// Load Details in modal
async function viewProjectDetails(projectId) {
  const modal = document.getElementById('project-details-modal');
  const modalTitle = document.getElementById('modal-project-title');
  const modalBody = document.getElementById('modal-project-body');

  modalBody.innerHTML = '<p style="color:var(--text-muted)">Fetching project tracking logs...</p>';
  modal.classList.add('active');

  try {
    const response = await fetch(`/api/projects/${projectId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const project = data.project;
    const tasks = data.tasks;

    modalTitle.innerText = project.title;
    
    let attachmentHTML = '';
    if (project.file_url) {
      attachmentHTML = `
        <div style="margin-bottom:1.25rem; padding:1rem; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color);">
          <div style="font-size:0.95rem; margin-bottom:0.5rem; color:var(--text-secondary)"><strong>Uploaded Project Bundle:</strong></div>
          <a href="${project.file_url}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:0.55rem 1rem; font-size:0.9rem; display:inline-flex; align-items:center; gap:0.5rem;">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14m7-7H5"/></svg>
            Download attachments
          </a>
        </div>
      `;
    }

    let tasksHTML = `
      <div style="margin-bottom:1.5rem">
        <p><strong>Description:</strong> ${project.description}</p>
        ${attachmentHTML}
        <p style="margin-top:0.5rem"><strong>Tech Stack:</strong> <span style="color:#a855f7">${project.technologies}</span></p>
        ${project.project_type === 'big' ? `<p style="margin-top:0.75rem; color:#a855f7; font-weight:600">Big Project Team Flow: first 4 interested workers form an automatic team.</p>` : ''}
        ${project.project_type === 'big' ? `<p style="margin-top:0.5rem; color:${project.status === 'team-assigned' ? '#10b981' : '#c084fc'}; font-weight:600">Interest: ${project.interest_count || 0}/4 · Team Members: ${project.team_size || 0}/4</p>` : ''}
        ${project.status === 'team-assigned' ? `<p style="margin-top:0.5rem; color:#10b981; font-weight:600">Team has been assigned and development is underway.</p>` : ''}
      </div>
      <h4 style="margin-bottom:1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem">Allocated Tasks (${tasks.length})</h4>
    `;

    if (tasks.length === 0) {
      tasksHTML += `<p style="color:var(--text-muted); font-style:italic">This project hasn't been split into tasks by administration yet. Check back soon.</p>`;
    } else {
      tasksHTML += `<div style="display:flex; flex-direction:column; gap:1rem">`;
      tasks.forEach(t => {
        let submissionSection = '';
        
        // Show download/view details if worker submitted code
        if (t.status === 'completed' || t.status === 'review') {
          submissionSection = `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid var(--border-color)">
              <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.5rem">Worker Code Submission:</div>
              <pre style="background:#000; padding:10px; border-radius:6px; font-size:0.8rem; overflow-x:auto; max-height:120px">${escapeHTML(t.code_submission || 'No code code text logged')}</pre>
              <div style="margin-top:0.5rem">
                <a href="data:text/plain;charset=utf-8,${encodeURIComponent(t.code_submission || '')}" download="task-${t.id}-deliverable.txt" class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.8rem">
                  Download Submission File
                </a>
              </div>
            </div>
          `;
        }

        tasksHTML += `
          <div class="glass-card" style="padding:1.5rem; background:rgba(255,255,255,0.01)">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
              <strong style="color:#fff">${t.title}</strong>
              <span class="status-badge ${t.status.replace(' ', '-')}">${t.status}</span>
            </div>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.75rem">${t.description || 'No description supplied'}</p>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted)">
              <div>Assigned Worker: <span style="color:#fff">${t.worker_name || 'Awaiting Claim'}</span></div>
              <div>Budget: <span style="color:#10b981">₹${t.payment_amount.toLocaleString('en-IN')}</span></div>
              <div>Deadline: <span style="color:#fff">${t.deadline}</span></div>
            </div>
            <!-- Progress indicator -->
            <div style="margin-top: 0.75rem; display:flex; align-items:center; gap:0.5rem">
              <span style="font-size:0.8rem">Task Progress:</span>
              <div style="flex:1; height:6px; background:rgba(255,255,255,0.05); border-radius:99px; overflow:hidden">
                <div style="width:${t.progress}%; height:100%; background:var(--color-primary); border-radius:99px"></div>
              </div>
              <span style="font-size:0.8rem">${t.progress}%</span>
            </div>
            ${submissionSection}
          </div>
        `;
      });
      tasksHTML += `</div>`;
    }

    let workspaceBtn = '';
    if (project.group_id) {
      workspaceBtn = `
        <div style="margin-top:1.5rem; text-align:center">
          <button class="btn btn-primary" style="width:auto; padding:0.6rem 1.5rem" onclick="openClientWorkspace(${project.id}, ${project.group_id})">💬 Open Secure Project Workspace</button>
        </div>
      `;
    }

    modalBody.innerHTML = tasksHTML + workspaceBtn;

  } catch (err) {
    modalBody.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
  }
}

function closeProjectModal() {
  document.getElementById('project-details-modal').classList.remove('active');
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Client cancel a pending project
async function cancelClientProject(projectId) {
  if (!confirm('Are you sure you want to cancel this project? This cannot be undone.')) return;
  try {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    clientProjectsCache = null;
    showToast(data.message, 'success');
    loadClientProjects();
    loadDashboardSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ------------------------------------------
// VIEW 4: PAYMENT HISTORY
// ------------------------------------------
async function loadPaymentHistory() {
  const tbody = document.getElementById('payment-history-table-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading payment statements...</td></tr>';

  try {
    const response = await fetch('/api/projects/client', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const projects = data.projects;
    tbody.innerHTML = '';

    projects.forEach(p => {
      if (p.tasks) {
        p.tasks.forEach(t => {
          const tr = document.createElement('tr');
          // Map payment status indicators
          let payStatus = t.payment_status;
          if (t.status !== 'completed' && payStatus === 'pending') {
            payStatus = 'escrow held';
          }

          tr.innerHTML = `
            <td><strong>${p.title}</strong></td>
            <td>${t.title}</td>
            <td>${t.assigned_worker_id ? 'Vetted Contractor' : 'Unallocated'}</td>
            <td>₹${t.payment_amount.toLocaleString('en-IN')}</td>
            <td><span class="status-badge ${payStatus.replace(' ', '-')}">${payStatus}</span></td>
          `;
          tbody.appendChild(tr);
        });
      }
    });

    if (tbody.innerHTML === '') {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted)">No payment transaction logs logged yet.</td></tr>`;
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${err.message || 'Unable to load payment history.'}</td></tr>`;
  }
}

// ------------------------------------------
// VIEW 5: CHAT SUPPORT (WEBSOCKETS)
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
      ul.innerHTML = '<li style="padding:1.5rem; color:var(--text-muted)">No operators available.</li>';
      return;
    }

    // Automatically open first chat contact if none selected
    if (!currentChatContactId && contacts.length > 0) {
      currentChatContactId = contacts[0].id;
      selectChatContact(contacts[0].id, contacts[0].name);
    } else if (currentChatContactId) {
      const activeName = contacts.find(c => c.id === currentChatContactId)?.name || contacts[0].name;
      selectChatContact(currentChatContactId, activeName);
    }

  } catch (err) {
    ul.innerHTML = `<li style="padding:1.5rem; color:#ef4444">${err.message}</li>`;
  }
}

async function selectChatContact(contactId, contactName) {
  currentChatContactId = contactId;

  // Set active class in sidebar contacts
  const contacts = document.querySelectorAll('.contact-item');
  contacts.forEach(c => c.classList.remove('active'));
  // Find which list element matches this index
  const index = Array.from(contacts).findIndex(c => c.querySelector('.contact-name').innerText === contactName);
  if (index !== -1) contacts[index].classList.add('active');

  const chatWindow = document.getElementById('chat-window-box');
  chatWindow.innerHTML = `
    <div class="chat-window-header">
      <div class="contact-avatar">${contactName.charAt(0).toUpperCase()}</div>
      <div class="chat-window-name">${contactName}</div>
    </div>
    <div class="chat-messages-container" id="chat-messages-box">
      <p style="color:var(--text-muted); text-align:center">Loading conversation logs...</p>
    </div>
    <div class="chat-input-panel">
      <input type="text" id="chat-input-message" class="chat-input" placeholder="Type message to administrative staff..." onkeydown="handleChatInputKey(event)">
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
    loadUnreadMessagesCount(); // Update unread count

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
    // HTTP fallback if socket disconnected
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
const _notifMessages = {};

function appendMessageToWindow(msg) {
  const container = document.getElementById('chat-messages-box');
  if (!container) return;

  const isSelf = msg.sender_id === activeUser.id;
  const bubbleWrapper = document.createElement('div');
  const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgText = msg.message || '';
  const isBudgetRevisionReq = msgText.includes('[BUDGET REVISION REQUEST');
  const isBudgetRevised = msgText.includes('[BUDGET REVISED');
  const isBudgetAccepted = msgText.includes('[BUDGET ACCEPTED');
  const msgKey = `msg_${msg.id || Date.now()}`;
  _notifMessages[msgKey] = msgText; // store raw message for action functions

  if (isBudgetRevisionReq && !isSelf) {
    // Admin sent a budget revision request — client sees it with action buttons
    bubbleWrapper.className = 'chat-notification-card budget-request-card';
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">⚠️</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Admin Requesting Budget Revision</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-actions">
          <button class="btn btn-primary notif-accept-btn" data-msgkey="${msgKey}" style="padding:0.35rem 0.9rem; font-size:0.82rem; background:#10b981; border-color:#059669;">✓ Accept Suggested Budget</button>
          <button class="btn btn-secondary notif-revise-btn" data-msgkey="${msgKey}" style="padding:0.35rem 0.9rem; font-size:0.82rem; background:#f59e0b; border-color:#d97706; color:#fff;">✎ Propose Different Budget</button>
          <button class="btn btn-secondary notif-reject-btn" data-msgkey="${msgKey}" style="padding:0.35rem 0.9rem; font-size:0.82rem; background:#ef4444; border-color:#dc2626; color:#fff;">✗ Reject</button>
        </div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
    // Attach event listeners after insertion
    setTimeout(() => {
      const acceptBtn = bubbleWrapper.querySelector('.notif-accept-btn');
      const reviseBtn = bubbleWrapper.querySelector('.notif-revise-btn');
      const rejectBtn = bubbleWrapper.querySelector('.notif-reject-btn');
      if (acceptBtn) acceptBtn.addEventListener('click', () => clientAcceptRevisionFromChat(acceptBtn, _notifMessages[msgKey]));
      if (reviseBtn) reviseBtn.addEventListener('click', () => clientOpenReviseFromChat(_notifMessages[msgKey]));
      if (rejectBtn) rejectBtn.addEventListener('click', () => clientRejectRevisionFromChat(rejectBtn, _notifMessages[msgKey]));
    }, 0);
  } else if (isBudgetRevised && isSelf) {
    // Client sent their revised budget — show as sent notification card
    bubbleWrapper.className = 'chat-notification-card budget-revised-card sent-notif';
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">💰</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Revised Budget Submitted to Admin</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
  } else if (isBudgetAccepted && !isSelf) {
    // Admin accepted our revised budget
    bubbleWrapper.className = 'chat-notification-card budget-accepted-card';
    bubbleWrapper.innerHTML = `
      <div class="chat-notif-icon">✅</div>
      <div class="chat-notif-body">
        <div class="chat-notif-title">Admin Accepted Your Revised Budget!</div>
        <div class="chat-notif-message">${escapeHTML(msgText)}</div>
        <div class="chat-notif-time">${timeString}</div>
      </div>
    `;
    // Refresh projects list to reflect updated status
    clientProjectsCache = null;
    setTimeout(() => loadClientProjects(), 500);
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

// --- CLIENT BUDGET REVISION CHAT ACTIONS ---


async function clientAcceptRevisionFromChat(btn, msgText) {
  const projMatch = msgText.match(/PROJECT: "([^"]+)"/);
  const budgetMatch = msgText.match(/₹([\d,]+)/);
  if (!projMatch) {
    showToast('Could not identify project from notification.', 'error');
    return;
  }
  const projTitle = projMatch[1];
  // Find project (clear cache to get fresh data)
  clientProjectsCache = null;
  const data = await getClientProjects();
  const proj = (data.projects || []).find(p => p.title === projTitle);
  if (!proj) {
    showToast('Project not found. Please check Active Projects.', 'warning');
    return;
  }
  // Accept the admin's suggested budget — accept=true
  try {
    const response = await fetch(`/api/projects/${proj.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ accept: true })
    });
    const resData = await response.json();
    if (!response.ok) throw new Error(resData.error);
    clientProjectsCache = null;
    showToast('✅ Budget accepted! Project moved to development.', 'success');
    if (btn) { btn.disabled = true; btn.innerText = '✓ Accepted'; btn.style.opacity = '0.6'; }
    // Disable sibling buttons too
    const actions = btn.closest('.chat-notif-actions');
    if (actions) actions.querySelectorAll('button').forEach(b => b.disabled = true);
    loadClientProjects();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function clientOpenReviseFromChat(msgText) {
  const projMatch = msgText.match(/PROJECT: "([^"]+)"/);
  const budgetMatch = msgText.match(/₹([\d,]+)/);
  if (!projMatch) {
    showToast('Could not identify project from notification.', 'error');
    return;
  }
  const projTitle = projMatch[1];
  getClientProjects().then(data => {
    const proj = (data.projects || []).find(p => p.title === projTitle);
    if (!proj) { showToast('Project not found.', 'warning'); return; }
    openClientBudgetRevisionModal(proj.id, proj.revision_requested_budget || proj.budget);
  });
}

async function clientRejectRevisionFromChat(btn, msgText) {
  const projMatch = msgText.match(/PROJECT: "([^"]+)"/);
  if (!projMatch) {
    showToast('Could not identify project from notification.', 'error');
    return;
  }
  const projTitle = projMatch[1];
  const data = await getClientProjects();
  const proj = (data.projects || []).find(p => p.title === projTitle);
  if (!proj) { showToast('Project not found.', 'warning'); return; }
  try {
    const response = await fetch(`/api/projects/${proj.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ accept: false })
    });
    const resData = await response.json();
    if (!response.ok) throw new Error(resData.error);
    clientProjectsCache = null;
    showToast('Revision rejected. Project returned to pending.', 'info');
    if (btn) { btn.disabled = true; btn.innerText = '✗ Rejected'; btn.style.opacity = '0.6'; }
    const actions = btn.closest('.chat-notif-actions');
    if (actions) actions.querySelectorAll('button').forEach(b => b.disabled = true);
    loadClientProjects();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleIncomingChatMessage(msg) {
  const isBudgetRevisionReq = (msg.message || '').includes('[BUDGET REVISION REQUEST');
  const isBudgetAccepted = (msg.message || '').includes('[BUDGET ACCEPTED');
  // If the chat window is currently open for the sender of this message
  if (currentChatContactId === msg.sender_id) {
    appendMessageToWindow(msg);
    scrollChatToBottom();
    // Hit API to mark as read
    fetch(`/api/messages/history/${msg.sender_id}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
  } else {
    if (isBudgetRevisionReq) {
      showToast(`⚠️ Admin is requesting a budget revision! Check Chat to respond.`, 'warning');
    } else if (isBudgetAccepted) {
      showToast(`✅ Admin accepted your revised budget! Project moving to development.`, 'success');
      clientProjectsCache = null;
    } else {
      showToast(`New support message received from Admin`, 'info');
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
// VIEW 6: SETTINGS FORM MANAGEMENT
// ------------------------------------------
function loadSettingsForm() {
  document.getElementById('profile-name').value = activeUser.name;
  document.getElementById('profile-company').value = activeUser.company_name || '';
  document.getElementById('profile-phone').value = activeUser.phone || '';
}

function setupSettingsForms() {
  // Profile settings update (mocked)
  const profileForm = document.getElementById('settings-profile-form');
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    activeUser.name = document.getElementById('profile-name').value;
    activeUser.company_name = document.getElementById('profile-company').value;
    activeUser.phone = document.getElementById('profile-phone').value;
    
    setUser(activeUser);
    document.getElementById('client-name-label').innerText = activeUser.name;
    document.getElementById('client-avatar').innerText = activeUser.name.charAt(0).toUpperCase();
    
    showToast('Profile information successfully saved (mocked).', 'success');
  });

  // Password update (mocked)
  const passForm = document.getElementById('settings-password-form');
  passForm.addEventListener('submit', (e) => {
    e.preventDefault();
    passForm.reset();
    showToast('Your password credentials have been updated.', 'success');
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
          <td>${escapeHtml(item.user_agent || '—')}</td>
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
            <div style="margin-top:0.75rem; white-space:pre-wrap; color:#d1d5db;">${escapeHtml(doc.content)}</div>
          </details>
        </div>
      `).join('');
    }
  } catch (err) {
    latestAcceptedText.innerText = 'Unable to load data';
    currentVersionText.innerText = 'Unable to load data';
    historyBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444">${escapeHtml(err.message)}</td></tr>`;
    currentDocsContainer.innerHTML = `<p style="color:#ef4444;">${escapeHtml(err.message)}</p>`;
  }
}

function openClientBudgetRevisionModal(projectId, currentBudget) {
  document.getElementById('client-revision-project-id').value = projectId;
  document.getElementById('client-revision-budget').value = currentBudget;
  document.getElementById('client-budget-revision-modal').classList.add('active');
}

function closeClientBudgetRevisionModal() {
  document.getElementById('client-budget-revision-modal').classList.remove('active');
}

async function acceptBudgetRevision(projectId, accept) {
  try {
    const response = await fetch(`/api/projects/${projectId}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ accept })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    clientProjectsCache = null;
    showToast(data.message, 'success');
    loadClientProjects();
    loadDashboardSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.getElementById('client-budget-revision-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const projectId = document.getElementById('client-revision-project-id').value;
  const budget = parseFloat(document.getElementById('client-revision-budget').value);

  try {
    const response = await fetch(`/api/projects/${projectId}/revise-budget`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ budget })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    clientProjectsCache = null;
    showToast(data.message, 'success');
    closeClientBudgetRevisionModal();
    loadClientProjects();
    loadDashboardSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// SECURE WORKSPACE CLIENT-SIDE CONTROLLERS
// ==========================================

async function openClientWorkspace(projectId, groupId) {
  const modalBody = document.getElementById('modal-project-body');
  
  modalBody.innerHTML = `
    <button class="btn btn-secondary" onclick="viewProjectDetails(${projectId})" style="margin-bottom: 1.5rem; width: auto;">&larr; Back to Tasks</button>
    
    <div class="glass-card" style="padding: 1.5rem; background: rgba(15,22,41,0.7); border: 1px solid rgba(255,255,255,0.08);">
      <h3 style="margin-top:0; color:#fff">Project Workspace</h3>
      
      <!-- Secure Workspace Features Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem; margin-top:1.5rem;">
        
        <!-- Left Column: File Sharing & Voice Sync -->
        <div class="glass-card" style="padding:1.25rem; background:rgba(15,22,41,0.5)">
          <h4 style="margin-top:0; color:#a855f7; display:flex; align-items:center; gap:0.5rem">
            📁 Shared Files &amp; Voice Sync
          </h4>
          
          <!-- File List -->
          <div id="workspace-files-container" style="max-height:180px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:0.5rem; background:rgba(0,0,0,0.15); margin-bottom:1rem">
            <p style="color:var(--text-muted); font-size:0.85rem">Loading files...</p>
          </div>

          <!-- File Upload Form -->
          <div style="display:flex; gap:0.5rem; margin-bottom:1rem">
            <input type="file" id="workspace-file-input" style="display:none" onchange="uploadWorkspaceFileClient(${projectId})">
            <button class="btn btn-secondary" style="width:auto; font-size:0.8rem; padding:0.4rem 1rem" onclick="document.getElementById('workspace-file-input').click()">📤 Share File</button>
          </div>
        </div>

        <!-- Right Column: Milestones & Progress Logs -->
        <div class="glass-card" style="padding:1.25rem; background:rgba(15,22,41,0.5)">
          <h4 style="margin-top:0; color:#a855f7">🏆 Milestones</h4>
          <div id="workspace-milestones-container" style="max-height:100px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:0.5rem; background:rgba(0,0,0,0.15); margin-bottom:1rem">
            <p style="color:var(--text-muted); font-size:0.85rem">Loading milestones...</p>
          </div>
          
          <!-- Client Milestone Creation Form -->
          <form id="client-milestone-form" style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:1.5rem" onsubmit="createWorkspaceMilestoneClient(event, ${projectId})">
            <input type="text" id="milestone-title" placeholder="Milestone Title" required style="background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.85rem">
            <input type="text" id="milestone-desc" placeholder="Description" style="background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.85rem">
            <div style="display:flex; gap:0.5rem">
              <input type="number" id="milestone-amount" placeholder="Amount" style="flex:1; background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.35rem; border-radius:6px; font-size:0.85rem">
              <input type="date" id="milestone-deadline" style="flex:1; background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.35rem; border-radius:6px; font-size:0.85rem">
            </div>
            <button type="submit" class="btn btn-secondary" style="width:auto; font-size:0.8rem; padding:0.4rem 1.25rem">Add Milestone</button>
          </form>

          <h4 style="margin-top:1rem; color:#a855f7">📈 Progress Updates Log</h4>
          <div id="workspace-progress-container" style="max-height:100px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:0.5rem; background:rgba(0,0,0,0.15)">
            <p style="color:var(--text-muted); font-size:0.85rem">Loading logs...</p>
          </div>
        </div>

      </div>

      <!-- Sync Chat Section -->
      <div class="glass-card" style="margin-top:1.5rem; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; background:rgba(15,22,41,0.5)">
        <h4 style="margin:0; color:#a855f7">💬 Project Group Chat</h4>
        <div id="group-chat-messages" style="height:180px; overflow-y:auto; border:1px solid var(--border-color); border-radius:8px; padding:0.75rem; background:rgba(0,0,0,0.25); display:flex; flex-direction:column; gap:0.5rem;">
          <p style="color:var(--text-muted); font-size:0.85rem">Loading conversation...</p>
        </div>
        <form id="group-chat-form" style="display:flex; gap:0.5rem" onsubmit="sendGroupChatMessageClient(event, ${groupId})">
          <input type="text" id="group-chat-input" placeholder="Type a message to the team..." required style="flex:1; background:rgba(0,0,0,0.25); border:1px solid var(--border-color); color:#fff; padding:0.4rem 0.8rem; border-radius:6px; font-size:0.85rem" />
          <button type="submit" class="btn btn-primary" style="width:auto; padding:0.4rem 1.25rem; font-size:0.85rem">Send</button>
        </form>
      </div>

    </div>
  `;

  // Trigger workspace data loads
  loadWorkspaceFilesClient(projectId);
  loadWorkspaceMilestonesClient(projectId);
  loadWorkspaceProgressClient(projectId);
  loadGroupChatHistoryClient(groupId);
}

async function loadGroupChatHistoryClient(groupId) {
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
      container.innerHTML = `<p style="color:var(--text-muted); font-size:0.82rem; font-style:italic; text-align:center; margin-top:1.5rem">No messages in this workspace channel yet.</p>`;
    } else {
      messages.forEach(m => {
        const div = document.createElement('div');
        div.style.marginBottom = '0.5rem';
        div.style.padding = '0.4rem 0.75rem';
        div.style.borderRadius = '6px';
        div.style.background = m.sender_role === 'client' ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)';
        div.style.border = m.sender_role === 'client' ? '1px solid rgba(99,102,241,0.2)' : '1px solid rgba(255,255,255,0.05)';
        
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:0.15rem">
            <strong style="color:${m.sender_role === 'client' ? 'var(--color-primary)' : '#fff'}">${m.sender_name} (${m.sender_role})</strong>
            <span style="color:var(--text-muted)">${new Date(m.created_at).toLocaleTimeString()}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--text-secondary); word-break:break-all">${m.message}</div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:0.8rem">Failed to load chat history: ${err.message}</p>`;
  }
}

async function sendGroupChatMessageClient(event, groupId) {
  event.preventDefault();
  const input = document.getElementById('group-chat-input');
  const message = input.value.trim();
  if (!message) return;

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
    
    input.value = '';
    loadGroupChatHistoryClient(groupId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadWorkspaceFilesClient(projectId) {
  const container = document.getElementById('workspace-files-container');
  try {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    container.innerHTML = '';
    const files = data.files || [];
    if (files.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic">No files shared yet.</p>';
    } else {
      files.forEach(f => {
        const item = document.createElement('div');
        item.style.padding = '0.4rem';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        
        const isVoice = f.file_type === 'voice';
        const icon = isVoice ? '🎤' : '📁';
        const displayLink = isVoice 
          ? `<audio controls src="${f.file_url}" style="height:25px; max-width:140px;"></audio>`
          : `<a href="${f.file_url}" target="_blank" style="color:var(--color-primary); font-size:0.8rem; text-decoration:none;">Download</a>`;

        item.innerHTML = `
          <div>
            <span style="font-size:0.85rem; color:#fff">${icon} ${f.file_name}</span>
            <span style="font-size:0.65rem; color:var(--text-muted); display:block;">Shared by ${f.uploader_name}</span>
          </div>
          <div>${displayLink}</div>
        `;
        container.appendChild(item);
      });
    }
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:0.8rem">Error: ${err.message}</p>`;
  }
}

async function uploadWorkspaceFileClient(projectId) {
  const fileInput = document.getElementById('workspace-file-input');
  if (fileInput.files.length === 0) return;
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  formData.append('file_type', 'file');

  try {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('File shared successfully!', 'success');
    fileInput.value = '';
    loadWorkspaceFilesClient(projectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadWorkspaceMilestonesClient(projectId) {
  const container = document.getElementById('workspace-milestones-container');
  try {
    const res = await fetch(`/api/projects/${projectId}/milestones`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    container.innerHTML = '';
    const milestones = data.milestones || [];
    if (milestones.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic">No milestones defined yet.</p>';
    } else {
      milestones.forEach(m => {
        const item = document.createElement('div');
        item.style.padding = '0.4rem';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';

        const statusColor = m.status === 'completed' ? '#10b981' : '#f59e0b';
        const completeBtn = m.status === 'pending' 
          ? `<button class="btn btn-secondary" style="padding:0.15rem 0.4rem; font-size:0.65rem; width:auto;" onclick="completeWorkspaceMilestoneClient(${projectId}, ${m.id})">✓ Complete</button>`
          : '';

        item.innerHTML = `
          <div>
            <strong style="color:#fff; font-size:0.8rem">${m.title}</strong>
            <span style="font-size:0.7rem; color:var(--text-muted); display:block">${m.description || 'No description'}</span>
          </div>
          <div style="text-align:right">
            <span class="status-badge" style="font-size:0.6rem; padding:0.05rem 0.2rem; border-color:${statusColor}; color:${statusColor}; background:transparent">${m.status}</span>
            <span style="font-size:0.65rem; color:var(--text-muted); display:block; margin:0.1rem 0">${m.deadline || 'N/A'}</span>
            ${completeBtn}
          </div>
        `;
        container.appendChild(item);
      });
    }
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:0.8rem">Error: ${err.message}</p>`;
  }
}

async function createWorkspaceMilestoneClient(event, projectId) {
  event.preventDefault();
  const title = document.getElementById('milestone-title').value;
  const description = document.getElementById('milestone-desc').value;
  const amount = document.getElementById('milestone-amount').value;
  const deadline = document.getElementById('milestone-deadline').value;

  try {
    const res = await fetch(`/api/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ title, description, amount, deadline })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Milestone created successfully!', 'success');
    document.getElementById('client-milestone-form').reset();
    loadWorkspaceMilestonesClient(projectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function completeWorkspaceMilestoneClient(projectId, milestoneId) {
  try {
    const res = await fetch(`/api/projects/${projectId}/milestones/${milestoneId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Milestone marked completed!', 'success');
    loadWorkspaceMilestonesClient(projectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadWorkspaceProgressClient(projectId) {
  const container = document.getElementById('workspace-progress-container');
  try {
    const res = await fetch(`/api/projects/${projectId}/progress`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    container.innerHTML = '';
    const updates = data.updates || [];
    if (updates.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic">No progress logs submitted yet.</p>';
    } else {
      updates.forEach(u => {
        const item = document.createElement('div');
        item.style.padding = '0.4rem';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.15rem">
            <span style="font-size:0.75rem; color:#fff; font-weight:600">${u.worker_name} logged ${u.progress_percentage}%</span>
            <span style="font-size:0.65rem; color:var(--text-muted)">${new Date(u.created_at).toLocaleDateString()}</span>
          </div>
          <p style="margin:0; font-size:0.75rem; color:var(--text-secondary)">${u.update_text}</p>
        `;
        container.appendChild(item);
      });
    }
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:0.8rem">Error: ${err.message}</p>`;
  }
}
