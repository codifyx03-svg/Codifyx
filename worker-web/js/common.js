// ==========================================
// DEVFORCE INDIA - COMMON FRONTEND LOGIC
// ==========================================

// API_BASE can be set to your backend service URL (e.g., Cloud Run URL) if frontend and backend are on different domains.
const API_BASE = 'http://localhost:3003'; 

// JWT token helpers
function getToken() {
  return localStorage.getItem('df_token');
}

function setToken(token) {
  localStorage.setItem('df_token', token);
}

function getUser() {
  const user = localStorage.getItem('df_user');
  return user ? JSON.parse(user) : null;
}

function setUser(user) {
  localStorage.setItem('df_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('df_token');
  localStorage.removeItem('df_user');
  window.location.href = 'login.html';
}

// Authorization check helper
function checkAuth(allowedRoles = []) {
  const token = getToken();
  const user = getUser();

  if (!token || !user) {
    // If not logged in, redirect to login page (unless we are already on public pages like index, login, register, reset, verify)
    const page = window.location.pathname.split('/').pop();
    if (page && page !== 'index.html' && page !== 'login.html' && page !== 'register.html' && page !== 'forgot-password.html' && page !== 'verify.html') {
      window.location.href = 'login.html';
    }
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    // Redirect to correct dashboard based on role
    redirectUserDashboard(user.role);
    return null;
  }

  return user;
}

function redirectUserDashboard(role) {
  if (role === 'admin') {
    window.location.href = 'dashboard-admin.html';
  } else if (role === 'client') {
    window.location.href = 'dashboard-client.html';
  } else if (role === 'worker') {
    window.location.href = 'dashboard-worker.html';
  } else {
    window.location.href = 'index.html';
  }
}

// Global fetch wrapper to handle invalid/expired auth tokens and route relative /api/ calls
if (window.fetch) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    let url;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    // Intercept and route /api/ requests to the correct API_BASE domain
    if (url.startsWith('/api/') && API_BASE) {
      const newUrl = API_BASE + url;
      if (typeof input === 'string') {
        input = newUrl;
      } else if (input instanceof Request) {
        input = new Request(newUrl, input);
      } else {
        input = newUrl;
      }
    }

    const response = await originalFetch(input, init);
    if (response.status === 401) {
      logout();
      showToast('Session expired or invalid token. Please log in again.', 'error');
      return response;
    }
    if (response.status === 403) {
      let data;
      try {
        data = await response.clone().json();
      } catch (e) {
        data = null;
      }
      const errorMessage = data?.error || 'Access denied';
      if (errorMessage === 'Invalid or expired token' || errorMessage === 'Access token missing') {
        logout();
        showToast('Session expired or invalid token. Please log in again.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    }
    return response;
  };
}

function connectChatWS(onMessageReceived, onSentConfirm) {
  const token = getToken();
  if (!token) return null;

  let wsUri;
  if (API_BASE) {
    // If API_BASE is configured (e.g. https://xyz.a.run.app), convert to ws:// or wss://
    wsUri = API_BASE.replace(/^http/, 'ws');
  } else {
    const loc = window.location;
    wsUri = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUri += '//' + loc.host;
  }

  const socket = new WebSocket(wsUri);

  socket.addEventListener('open', () => {
    // Authenticate WS connection immediately
    socket.send(JSON.stringify({
      type: 'auth',
      token: token
    }));
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'message' && onMessageReceived) {
        onMessageReceived(payload.data);
      } else if (payload.type === 'message_sent' && onSentConfirm) {
        onSentConfirm(payload.data);
      } else if (payload.type === 'group_message' && onMessageReceived) {
        onMessageReceived({ ...payload.data, isGroup: true });
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  socket.addEventListener('close', () => {
    console.log('WS connection closed. Reconnecting in 3s...');
    setTimeout(() => connectChatWS(onMessageReceived, onSentConfirm), 3000);
  });

  return socket;
}

// Premium Toast Notification
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.innerText = message;
  toast.style.background = 'rgba(17, 22, 34, 0.95)';
  toast.style.color = '#fff';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '0.9rem';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.5)';
  toast.style.border = '1px solid rgba(255, 255, 255, 0.08)';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.transform = 'translateY(20px)';
  toast.style.opacity = '0';
  toast.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

  // Type specific color borders
  if (type === 'success') {
    toast.style.borderLeft = '4px solid #10b981';
  } else if (type === 'error') {
    toast.style.borderLeft = '4px solid #ef4444';
  } else if (type === 'warning') {
    toast.style.borderLeft = '4px solid #f59e0b';
  } else {
    toast.style.borderLeft = '4px solid #6366f1';
  }

  container.appendChild(toast);

  // Trigger animations
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 10);

  // Auto remove toast
  setTimeout(() => {
    toast.style.transform = 'translateY(-10px)';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Scroll anim init helper
document.addEventListener('DOMContentLoaded', () => {
  const faders = document.querySelectorAll('.fade-in, .slide-up');
  
  if ('IntersectionObserver' in window) {
    const appearOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px"
    };

    const appearOnScroll = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      });
    }, appearOptions);

    faders.forEach(fader => {
      // Set initial styles for transition if not yet set
      fader.style.opacity = '0';
      if (fader.classList.contains('slide-up')) {
        fader.style.transform = 'translateY(30px)';
      }
      fader.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
      
      appearOnScroll.observe(fader);
    });

    // Add CSS rules dynamically for active state
    const style = document.createElement('style');
    style.innerHTML = `
      .fade-in.active, .slide-up.active {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }
    `;
    document.head.appendChild(style);
  } else {
    // Fallback: make everything visible
    faders.forEach(f => f.style.opacity = '1');
  }
});

// Theme toggle logic
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light-theme');
  }
}
function toggleTheme() {
  if (document.body.classList.contains('light-theme')) {
    document.body.classList.remove('light-theme');
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.classList.add('light-theme');
    localStorage.setItem('theme', 'light');
  }
}
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.addEventListener('click', toggleTheme);

  // Responsive Sidebar Toggle Injection
  const header = document.querySelector('.dashboard-header');
  const sidebar = document.querySelector('.sidebar');
  if (header && sidebar) {
    // 1. Insert hamburger button into header
    header.insertAdjacentHTML('afterbegin', `
      <button class="sidebar-toggle" id="sidebar-toggle" onclick="toggleSidebar()" aria-label="Toggle Sidebar" style="margin-right: 1rem;">
        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    `);

    // 2. Close sidebar on click of items on mobile
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-menu-item a') || e.target.closest('.logout-btn') || e.target.closest('.sidebar-brand')) {
        sidebar.classList.remove('open');
      }
    });

    // 3. Close sidebar when clicking outside of it
    document.addEventListener('click', (e) => {
      const toggleBtn = document.getElementById('sidebar-toggle');
      if (sidebar.classList.contains('open') && 
          !sidebar.contains(e.target) && 
          !header.contains(e.target) && 
          (toggleBtn && !toggleBtn.contains(e.target))) {
        sidebar.classList.remove('open');
      }
    });
  }
});

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
}
