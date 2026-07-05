import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

const navItems = [
  { label: 'Platform', to: '/dashboard' },
  { label: 'Features', to: '#features' },
  { label: 'Why Codify', to: '#why' },
  { label: 'Contact', to: '#contact' }
];

const featureCards = [
  {
    title: 'Escrow-grade payments',
    text: 'Move funds safely inside the platform with admin-approved release rules and wallet-ledger transparency.',
    icon: '◉'
  },
  {
    title: 'Premium project intake',
    text: 'Turn messy client briefs into structured tasks, milestones, and delivery checkpoints with elegance.',
    icon: '◎'
  },
  {
    title: 'Real-time operations',
    text: 'Give your team a refined command center for approvals, worker handoffs, and payout visibility.',
    icon: '◌'
  }
];

const workflowSteps = [
  'Client submits a polished brief',
  'Admin splits work and assigns talent',
  'Worker delivers and the client approves',
  'Funds release instantly to the worker wallet'
];

const stats = [
  { label: 'Projects launched', value: '300+' },
  { label: 'Faster approvals', value: '4.8x' },
  { label: 'Wallet uptime', value: '99.99%' }
];

const roleCards = [
  {
    title: 'For clients',
    bullets: ['Launch work with structured briefs', 'Approve delivery in one click', 'Track budgets and milestones clearly']
  },
  {
    title: 'For workers',
    bullets: ['See assigned tasks in a clean workspace', 'Receive payouts inside the platform', 'Stay informed with milestone updates']
  },
  {
    title: 'For admins',
    bullets: ['Monitor every wallet movement', 'Release payments with confidence', 'Maintain complete audit visibility']
  }
];

const testimonials = [
  {
    quote: 'It feels like a venture-backed product, not a basic marketplace tool.',
    name: 'Aarav S.',
    role: 'Founder, Nova Labs'
  },
  {
    quote: 'The premium UI made our clients trust the platform instantly.',
    name: 'Mira T.',
    role: 'Head of Operations, BrightStack'
  },
  {
    quote: 'The mobile experience is smooth and the wallet flow feels genuinely premium.',
    name: 'Daniel R.',
    role: 'Product Lead, Studio North'
  }
];

function Navbar({ user, onLogout }) {
  return (
    <nav className="navbar">
      <Link className="brand" to="/">
        <span className="brand-mark">C</span>
        <span>Codify</span>
      </Link>
      <div className="nav-links">
        {navItems.map((item) => (
          <Link key={item.label} to={item.to}>
            {item.label}
          </Link>
        ))}
        <Link className="nav-cta" to="/admin">Admin</Link>
        {user ? (
          <button className="nav-cta" onClick={onLogout} type="button">Logout</button>
        ) : (
          <Link className="nav-cta" to="/login">Sign in</Link>
        )}
      </div>
    </nav>
  );
}

function Landing() {
  return (
    <div className="page-shell">
      <Navbar />
      <main className="main-stack">
        <section className="hero-card">
          <div className="hero-copy">
            <div className="badge-row">
              <span className="badge">Premium startup platform</span>
              <span className="badge soft">Mobile-first React experience</span>
            </div>
            <h1>Turn your freelance marketplace into a luxury experience.</h1>
            <p>Codify now delivers a polished, high-trust product surface for clients, workers, and admins with premium visuals, smart workflow states, and beautiful dashboards.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/dashboard">Explore platform</Link>
              <a className="btn btn-secondary" href="#features">View features</a>
            </div>
            <div className="metric-row">
              {stats.map((item) => (
                <div key={item.label} className="mini-stat">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-card">
              <div className="preview-top">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
              <div className="preview-body">
                <div className="panel large">
                  <p>Wallet balance</p>
                  <h3>₹1.24L</h3>
                </div>
                <div className="panel-stack">
                  <div className="panel small">
                    <p>Pending approvals</p>
                    <h4>14</h4>
                  </div>
                  <div className="panel small accent">
                    <p>Released payouts</p>
                    <h4>36</h4>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Features</p>
            <h2>Crafted for trust, clarity, and speed.</h2>
          </div>
          <div className="feature-grid">
            {featureCards.map((card) => (
              <article key={card.title} className="feature-card">
                <div className="feature-icon">{card.icon}</div>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="why" className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Why teams switch</p>
            <h2>One premium workspace for the whole delivery chain.</h2>
          </div>
          <div className="role-grid">
            {roleCards.map((role) => (
              <article key={role.title} className="role-card">
                <h3>{role.title}</h3>
                <ul>
                  {role.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block workflow-section">
          <div className="section-heading">
            <p className="eyebrow">Workflow</p>
            <h2>Designed around your growth loop.</h2>
          </div>
          <div className="workflow-grid">
            {workflowSteps.map((step, index) => (
              <div key={step} className="workflow-step">
                <span className="step-number">0{index + 1}</span>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="reviews" className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Loved by founders</p>
            <h2>Premium first impressions, every time.</h2>
          </div>
          <div className="testimonial-grid">
            {testimonials.map((item) => (
              <article key={item.name} className="testimonial-card">
                <p>“{item.quote}”</p>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="cta-card">
          <h2>Ready to launch your premium platform?</h2>
          <p>Bring your startup experience to life with a refined frontend built for modern trust, conversion, and mobile-ready delivery.</p>
          <Link className="btn btn-primary" to="/login">Start now</Link>
        </section>
      </main>

      <footer className="footer">
        <p>Built for modern client, worker, and admin experiences.</p>
      </footer>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      await onLogin(data);
    } catch (error) {
      setMessage(error.message || 'Unable to sign in right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell auth-shell">
      <Navbar />
      <div className="auth-card">
        <p className="eyebrow">Secure access</p>
        <h2>Welcome back</h2>
        <p>Sign in to your premium workspace and continue building with confidence.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" type="email" required />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" required />
          <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Continue'}</button>
        </form>
        {message ? <p className="status-message">{message}</p> : null}
        <p className="helper-text">Need admin access? Open <Link to="/admin">/admin</Link>.</p>
      </div>
    </div>
  );
}

function RegisterPage() {
  return (
    <div className="page-shell auth-shell">
      <Navbar />
      <div className="auth-card">
        <p className="eyebrow">Create account</p>
        <h2>Launch your workspace</h2>
        <p>Register as a client or worker and start using the platform immediately.</p>
        <div className="helper-card">
          <p>Registration is supported by the backend API. Open the login page to continue with your existing account.</p>
          <Link className="btn btn-secondary" to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}

function PendingApprovalPage() {
  return (
    <div className="page-shell auth-shell">
      <Navbar />
      <div className="auth-card">
        <p className="eyebrow">Awaiting review</p>
        <h2>Your worker account is pending approval.</h2>
        <p>Your profile is being reviewed by the admin team. You will be able to access the workspace once approval is completed.</p>
        <Link className="btn btn-secondary" to="/">Back home</Link>
      </div>
    </div>
  );
}

function DashboardPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectBudget, setProjectBudget] = useState('');
  const [projectDeadline, setProjectDeadline] = useState('');
  const [projectMessage, setProjectMessage] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawUpi, setWithdrawUpi] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('codify_token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        const profileResponse = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!profileResponse.ok) {
          throw new Error('Session expired');
        }
        const profileData = await profileResponse.json();
        if (profileData.user?.role === 'client') {
          const projectsResponse = await fetch('/api/projects/client', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!projectsResponse.ok) throw new Error('Unable to load projects');
          const projectsData = await projectsResponse.json();
          setProjects(projectsData.projects || []);
        }
        if (profileData.user?.role === 'worker') {
          const tasksResponse = await fetch('/api/tasks/assigned', {
            headers: { Authorization: `Bearer ${token}` }
          });
          const walletResponse = await fetch('/api/worker/wallet', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!tasksResponse.ok || !walletResponse.ok) throw new Error('Unable to load worker workspace');
          const tasksData = await tasksResponse.json();
          const walletData = await walletResponse.json();
          setTasks(tasksData.tasks || []);
          setWallet(walletData);
        }
      } catch (error) {
        setProjectMessage(error.message || 'Unable to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const handleCreateProject = async (event) => {
    event.preventDefault();
    const token = localStorage.getItem('codify_token');
    setProjectMessage('');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: projectTitle,
          description: projectDescription,
          budget: projectBudget,
          deadline: projectDeadline
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to create project');
      }
      setProjectMessage(data.message || 'Project created');
      setProjectTitle('');
      setProjectDescription('');
      setProjectBudget('');
      setProjectDeadline('');
      const refreshed = await fetch('/api/projects/client', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const refreshedData = await refreshed.json();
      setProjects(refreshedData.projects || []);
    } catch (error) {
      setProjectMessage(error.message || 'Unable to create project');
    }
  };

  const handleWithdrawal = async (event) => {
    event.preventDefault();
    const token = localStorage.getItem('codify_token');
    try {
      const response = await fetch('/api/worker/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: withdrawAmount, upi_id: withdrawUpi })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to request withdrawal');
      }
      setProjectMessage(data.message || 'Withdrawal requested');
      setWithdrawAmount('');
      setWithdrawUpi('');
      const refreshed = await fetch('/api/worker/wallet', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const walletData = await refreshed.json();
      setWallet(walletData);
    } catch (error) {
      setProjectMessage(error.message || 'Unable to request withdrawal');
    }
  };

  return (
    <div className="page-shell">
      <Navbar user={user} onLogout={onLogout} />
      <div className="dashboard-shell">
        <div className="dashboard-hero">
          <div>
            <p className="eyebrow">Operations center</p>
            <h2>Welcome back, {user?.name || 'team'}.</h2>
            <p>Your workspace is connected to the live platform APIs.</p>
          </div>
          <Link className="btn btn-secondary" to="/">Back home</Link>
        </div>

        {projectMessage ? <div className="status-banner">{projectMessage}</div> : null}

        {loading ? <p className="loading-text">Loading workspace…</p> : null}

        {user?.role === 'client' ? (
          <div className="dashboard-grid">
            <div className="card-panel">
              <div className="panel-title">Create a new project</div>
              <form className="auth-form" onSubmit={handleCreateProject}>
                <input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Project title" required />
                <textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="Project description" rows="4" required />
                <div className="form-row">
                  <input value={projectBudget} onChange={(event) => setProjectBudget(event.target.value)} placeholder="Budget" type="number" min="1" required />
                  <input value={projectDeadline} onChange={(event) => setProjectDeadline(event.target.value)} placeholder="Deadline" required />
                </div>
                <button className="btn btn-primary" type="submit">Create project</button>
              </form>
            </div>
            <div className="card-panel">
              <div className="panel-title">Your projects</div>
              {projects.length === 0 ? <p className="empty-state">No projects yet.</p> : (
                <div className="list-stack">
                  {projects.map((project) => (
                    <div key={project.id} className="list-item">
                      <strong>{project.title}</strong>
                      <span className="status-pill">{project.status}</span>
                      <small>Budget: ₹{Number(project.budget || 0).toLocaleString('en-IN')}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {user?.role === 'worker' ? (
          <div className="dashboard-grid">
            <div className="card-panel">
              <div className="panel-title">Wallet</div>
              <div className="stat-card compact-card">
                <p>Available balance</p>
                <strong>₹{Number(wallet?.balance?.available_balance || 0).toLocaleString('en-IN')}</strong>
              </div>
              <form className="auth-form" onSubmit={handleWithdrawal}>
                <input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="Amount" type="number" min="1" required />
                <input value={withdrawUpi} onChange={(event) => setWithdrawUpi(event.target.value)} placeholder="UPI ID" required />
                <button className="btn btn-primary" type="submit">Request withdrawal</button>
              </form>
            </div>
            <div className="card-panel">
              <div className="panel-title">Assigned tasks</div>
              {tasks.length === 0 ? <p className="empty-state">No assigned tasks yet.</p> : (
                <div className="list-stack">
                  {tasks.map((task) => (
                    <div key={task.id} className="list-item">
                      <strong>{task.title}</strong>
                      <span className="status-pill">{task.status}</span>
                      <small>{task.project_title}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {!user || (user.role !== 'client' && user.role !== 'worker') ? (
          <div className="card-panel">
            <div className="panel-title">Admin access</div>
            <p className="empty-state">Open the admin portal to manage workers, projects, and payments.</p>
            <Link className="btn btn-primary" to="/admin">Open admin portal</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('codify_admin_token');
    if (!token) {
      setLoading(false);
      return;
    }

    const loadAnalytics = async () => {
      try {
        const response = await fetch('/admin-api/analytics', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Unable to load admin metrics');
        }
        setAdmin({ email: localStorage.getItem('codify_admin_email') || 'admin' });
        setAnalytics(data);
      } catch (error) {
        setMessage(error.message || 'Unable to load admin metrics');
      } finally {
        setLoading(false);
      }
    };

    loadAnalytics();
  }, []);

  const handleAdminLogin = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await fetch('/admin-api/auth/portal-secure-login-x97', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Admin sign in failed');
      }
      localStorage.setItem('codify_admin_token', data.token);
      localStorage.setItem('codify_admin_email', data.admin?.email || email);
      setAdmin(data.admin);
      setMessage('Admin access ready');
      const analyticsResponse = await fetch('/admin-api/analytics', {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const analyticsData = await analyticsResponse.json();
      if (analyticsResponse.ok) {
        setAnalytics(analyticsData);
      }
    } catch (error) {
      setMessage(error.message || 'Unable to sign in as admin');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('codify_admin_token');
    localStorage.removeItem('codify_admin_email');
    setAdmin(null);
    setAnalytics(null);
  };

  return (
    <div className="page-shell auth-shell">
      <Navbar />
      <div className="auth-card">
        <p className="eyebrow">Admin portal</p>
        <h2>{admin ? `Welcome back, ${admin.email}` : 'Secure admin access'}</h2>
        <p>{admin ? 'Your admin dashboard is live through the backend API.' : 'Use your admin credentials to reach the finance, project, and security modules.'}</p>

        {message ? <div className="status-banner">{message}</div> : null}

        {!admin ? (
          <form className="auth-form" onSubmit={handleAdminLogin}>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Admin email" type="email" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" required />
            <button className="btn btn-primary" type="submit">Open admin portal</button>
          </form>
        ) : null}

        {admin && !loading ? (
          <div className="dashboard-grid admin-grid">
            <div className="card-panel">
              <div className="panel-title">Admin overview</div>
              <p className="empty-state">Analytics endpoint connected. Use this shell to expand into workers, payments, and security modules.</p>
              <pre className="code-block">{JSON.stringify(analytics, null, 2)}</pre>
            </div>
            <div className="card-panel">
              <button className="btn btn-secondary" onClick={handleLogout} type="button">Logout admin</button>
              <Link className="btn btn-primary" to="/dashboard">Open workspace</Link>
            </div>
          </div>
        ) : null}

        {loading ? <p className="loading-text">Loading admin session…</p> : null}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('codify_token');
    if (!token) return;

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        localStorage.removeItem('codify_token');
      });
  }, []);

  const handleLogin = async (data) => {
    localStorage.setItem('codify_token', data.token);
    setUser(data.user);

    const targetPath = data.redirectTo ? String(data.redirectTo).replace(/\.html$/i, '') : '/dashboard';
    if (targetPath.startsWith('/')) {
      navigate(targetPath);
    } else {
      navigate(`/${targetPath}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('codify_token');
    setUser(null);
    navigate('/');
  };

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />
        <Route path="/dashboard" element={user ? <DashboardPage user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
