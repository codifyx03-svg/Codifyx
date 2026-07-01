const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const database = require('./database');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devforce_secret_key_2026_super_secure_min_32_chars_long';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEBUG_OTP = process.env.DEBUG_OTP === 'true' || NODE_ENV !== 'production';

if (DEBUG_OTP) {
  console.log('⚠️  DEBUG_OTP is enabled. OTP codes will be returned in API responses for development testing only.');
}

// ==========================================
// SECURITY CONFIGURATION
// ==========================================
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 min
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50000; // Large limit for developer convenience
const AUTH_MAX_ATTEMPTS = parseInt(process.env.AUTH_MAX_ATTEMPTS) || 100;
const AUTH_LOCKOUT_DURATION_MINUTES = parseInt(process.env.AUTH_LOCKOUT_DURATION_MINUTES) || 15;

// Rate Limiters
const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Max 1000 attempts per 15 minutes for developer testing
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts, please try again later' }
});

// ==========================================
// GOOGLE OAUTH CONFIGURATION
// ==========================================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback';

// OTP Configuration
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;


// ==========================================
// EMAIL CONFIGURATION (GMAIL)
// ==========================================
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

let emailTransporter = null;
let usingEmailFallback = false;

function createEmailFallbackTransporter() {
  usingEmailFallback = true;
  emailTransporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true
  });
  console.log('ℹ️  [Email] Using local fallback email transport. Emails will be logged to the console.');
}

try {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('⚠️  [Email] Email credentials not configured in .env file. Email will use local fallback logging only.');
    createEmailFallbackTransporter();
  } else {
    emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: EMAIL_USER, pass: EMAIL_PASS }
    });
    emailTransporter.verify((err) => {
      if (err) {
        console.warn('❌ [Email] Gmail transporter verification failed:', err.message);
        createEmailFallbackTransporter();
      } else {
        console.log('✅ [Email] Gmail transporter connected successfully');
      }
    });
  }
} catch (e) {
  console.warn('❌ [Email] Failed to create transporter:', e.message);
  createEmailFallbackTransporter();
}

async function sendEmail(to, subject, htmlBody) {
  try {
    if (!emailTransporter) {
      createEmailFallbackTransporter();
    }

    const sendResult = await emailTransporter.sendMail({
      from: usingEmailFallback ? 'codifyx Platform <no-reply@codifyx.local>' : `"codifyx Platform" <${EMAIL_USER}>`,
      to,
      subject,
      html: htmlBody
    });

    if (usingEmailFallback) {
      console.log('📨 [Email Preview]');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(htmlBody);
      return true;
    }

    console.log(`✅ [Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error('❌ [Email] Failed to send:', err.message);
    if (!usingEmailFallback) {
      createEmailFallbackTransporter();
      console.log('ℹ️  [Email] Switched to fallback transport due to send failure.');
    }
    return false;
  }
}

// ==========================================
// TWILIO SMS CONFIGURATION
// ==========================================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function sendSMS(toPhone, messageBody) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log(`[SMS DISABLED] To: ${toPhone}\nMessage: ${messageBody}`);
    return false;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: TWILIO_PHONE_NUMBER,
        To: toPhone,
        Body: messageBody
      }).toString()
    });

    const result = await response.json();
    if (response.ok) {
      console.log(`✅ [SMS] Sent to ${toPhone}: SID ${result.sid}`);
      return true;
    } else {
      console.error(`❌ [SMS] Failed:`, result);
      return false;
    }
  } catch (err) {
    console.error('❌ [SMS] Error:', err.message);
    return false;
  }
}

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ==========================================
// PASSPORT CONFIGURATION
// ==========================================

// Session middleware with secure options
app.use(session({
  secret: process.env.SESSION_SECRET || 'session_secret_key_2026_super_secure_min_32_chars',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS attacks
    sameSite: 'strict', // CSRF protection
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================
// Helmet helps secure Express apps by setting various HTTP headers
app.disable('x-powered-by');
app.use(helmet());

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
};

// Apply security middleware
app.use(generalLimiter); // Rate limiting on all requests
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Prevent parameter pollution
app.use((req, res, next) => {
  if (Array.isArray(req.query.email) || Array.isArray(req.body?.email)) {
    return res.status(400).json({ error: 'Invalid request format' });
  }
  next();
});

// Set custom security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy
if (!GOOGLE_CLIENT_ID.includes('YOUR_')) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists by Google ID
      const user = await database.get('SELECT * FROM users WHERE google_id = ?', [profile.id]);
      if (user) {
        return done(null, user);
      }
      // Check if user exists by email
      const userByEmail = await database.get('SELECT * FROM users WHERE email = ?', [profile.emails[0].value]);
      if (userByEmail) {
        // Link Google ID to existing user
        await database.run('UPDATE users SET google_id = ? WHERE id = ?', [profile.id, userByEmail.id]);
        return done(null, userByEmail);
      }
      // Create new user (if needed)
      done(null, profile);
    } catch (err) {
      done(err);
    }
  }));
}

// Serialize and Deserialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id || user);
});

passport.deserializeUser(async (id, done) => {
  try {
    if (typeof id === 'number') {
      const user = await database.get('SELECT * FROM users WHERE id = ?', [id]);
      done(null, user);
    } else {
      done(null, id);
    }
  } catch (err) {
    done(err);
  }
});


// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized role access' });
    }
    next();
  };
}

// ==========================================
// 1. AUTHENTICATION API
// ==========================================

// Register - with rate limiting and input validation
app.post('/api/auth/register', 
  authLimiter,
  upload.single('resume'),
  [
    body('email').isEmail().normalizeEmail().trim(),
    body('password').isLength({ min: 8 }).trim(),
    body('name').notEmpty().trim().escape(),
    body('role').isIn(['client', 'worker']),
    body('phone').optional({ checkFalsy: true }).custom(value => {
      return typeof value === 'string' && /^\+?[0-9\s()\-]{7,25}$/.test(value);
    }).withMessage('Invalid phone number format'),
    body('age').optional({ checkFalsy: true }).isInt({ min: 18, max: 80 }),
    body('skills').optional().trim().escape(),
    body('experience').optional().trim().escape(),
    body('company_name').optional().trim().escape(),
    body('available_hours').optional({ checkFalsy: true }).isInt({ min: 0, max: 168 })
  ],
  async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid input data', details: errors.array() });
    }

    const { role, email, password, name, company_name, phone, age, skills, experience, available_hours } = req.body;

    // Password strength validation
    const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
    if (!passwordStrengthRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters, include uppercase, lowercase, number, and special character' });
    }

    // Workers no longer need to upload resume during initial registration

    const userExists = await database.get('SELECT id FROM users WHERE email = ?', [email]);
    if (userExists) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    // Approval auto-set: clients and admins auto-approved. Workers need admin approval.
    const approved = role === 'worker' ? 0 : 1;
    const verificationCode = crypto.randomBytes(4).toString('hex');

    let resumeUrl = null;
    if (req.file) {
      resumeUrl = `/uploads/${req.file.filename}`;
    }

    const result = await database.run(
      `INSERT INTO users (role, email, password_hash, name, company_name, phone, age, skills, resume_url, experience, available_hours, approved, verification_code, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        role,
        email,
        passwordHash,
        name,
        company_name || null,
        phone || null,
        age ? parseInt(age) : null,
        skills || null,
        resumeUrl,
        experience || null,
        available_hours ? parseInt(available_hours) : null,
        approved,
        verificationCode
      ]
    );

    res.json({
      success: true,
      message: role === 'worker'
        ? 'Registration successful! Your worker profile is now created and will await admin approval.'
        : 'Registration successful! You can now log in with your email and password.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed due to server error' });
  }
});

// Verify Email
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await database.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verification_code !== code) return res.status(400).json({ error: 'Invalid verification code' });

    await database.run('UPDATE users SET verified = 1 WHERE id = ?', [user.id]);
    res.json({ success: true, message: 'Email verified successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Forgot Password (Simulated)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await database.get('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'Email not found' });

    // Mock reset token
    const mockCode = Math.floor(100000 + Math.random() * 900000).toString();
    await database.run('UPDATE users SET verification_code = ? WHERE id = ?', [mockCode, user.id]);

    res.json({
      success: true,
      message: 'Password reset code sent to email (simulated).',
      code: mockCode // Returned for visual testing
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Request failed' });
  }
});

// Reset Password (Simulated)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const user = await database.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verification_code !== code) return res.status(400).json({ error: 'Invalid reset code' });

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await database.run('UPDATE users SET password_hash = ?, verification_code = NULL WHERE id = ?', [passwordHash, user.id]);

    res.json({ success: true, message: 'Password has been reset successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Login
app.post('/api/auth/login', 
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().trim(),
    body('password').notEmpty().trim()
  ],
  async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid input data' });
    }

    const { email, password } = req.body;
    const user = await database.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    // Check if worker needs approval
    if (user.role === 'worker') {
      if (!user.approved) {
        return res.json({
          success: true,
          token,
          user: { id: user.id, name: user.name, role: user.role, email: user.email },
          redirectTo: 'pending-approval.html',
          message: 'Your profile is awaiting admin approval'
        });
      }
    }

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[Login Error]:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await database.get('SELECT id, role, email, name, company_name, phone, age, skills, resume_url, experience, available_hours, approved FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// ==========================================
// GOOGLE OAUTH ENDPOINTS
// ==========================================

// Initiate Google OAuth for client or worker
app.get('/api/auth/google/start', (req, res) => {
  const role = req.query.role || 'client'; // client or worker
  if (!['client', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  
  if (GOOGLE_CLIENT_ID.includes('YOUR_')) {
    return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.' });
  }
  
  // Generate state and save to database
  const state = crypto.randomBytes(16).toString('hex');
  database.run(`INSERT INTO oauth_sessions (state, role, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))`, [state, role])
    .catch(err => console.error('OAuth state save error:', err));

  // Redirect to Google OAuth
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'profile email',
    state
  });
  
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing auth code or state' });
    }

    // Verify state
    const oauthSession = await database.get('SELECT * FROM oauth_sessions WHERE state = ?', [state]);
    if (!oauthSession) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Exchange code for token (simplified - in production use google-auth-library)
    const role = oauthSession.role;
    
    // For now, return a message asking user to complete signup
    // In production, you would exchange the code for tokens and get profile info
    res.json({
      success: true,
      message: 'Google auth initiated. Complete your profile.',
      role,
      redirectTo: `/?role=${role}&auth=google`
    });
  } catch (err) {
    console.error('Google callback error:', err);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// ==========================================
// EMAIL OTP ENDPOINTS
// ==========================================

// Helper function to generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to send OTP email
async function sendOTPEmail(email, otp, role) {
  const subject = `codifyx Email Verification - Your OTP Code`;
  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f1629;color:#f3f4f6;padding:32px;border-radius:12px;">
      <h2 style="color:#10b981;margin-bottom:8px;">Email Verification</h2>
      <p style="color:#9ca3af;margin-bottom:24px;">You requested to sign up as a <strong>${role === 'worker' ? 'Developer/Worker' : 'Client/Employer'}</strong> on codifyx.</p>
      <div style="background:#1e2a45;padding:20px;border-radius:8px;margin-bottom:24px;text-align:center;">
        <div style="font-size:32px;font-weight:bold;color:#10b981;letter-spacing:8px;">${otp}</div>
        <p style="color:#9ca3af;margin-top:10px;font-size:12px;">Valid for 10 minutes</p>
      </div>
      <p style="color:#9ca3af;">If you didn't request this code, please ignore this email.</p>
      <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:32px;">codifyx Platform — Automated Notification</p>
    </div>
  `;
  
  await sendEmail(email, subject, htmlBody);
}

// Request Email OTP for signup
app.post('/api/auth/email-otp/request', async (req, res) => {
  try {
    const { email, role } = req.body;
    
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    if (!['client', 'worker'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Only client and worker support OTP auth.' });
    }

    // Check if email already exists (for non-OAuth users)
    const existingUser = await database.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }

    // Check if OTP session already exists and is still valid
    const existingOTP = await database.get(
      `SELECT * FROM otp_sessions WHERE email = ? AND role = ? AND otp_type = 'email' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
      [email, role]
    );

    if (existingOTP) {
      // Resend the same OTP if requested within 1 minute
      const createdTime = new Date(existingOTP.created_at);
      const now = new Date();
      if ((now - createdTime) < 60000) {
        await sendOTPEmail(email, existingOTP.otp_code, role);
        return res.json({ success: true, message: 'OTP resent to your email' });
      }
    }

    // Generate new OTP
    const otp = generateOTP();
    
    // Save OTP session
    await database.run(
      `INSERT INTO otp_sessions (email, otp_code, otp_type, role, created_at, expires_at, attempt_count) 
       VALUES (?, ?, 'email', ?, datetime('now'), datetime('now', '+10 minutes'), 0)`,
      [email, otp, role]
    );

    // Send OTP email
    await sendOTPEmail(email, otp, role);

    res.json({ 
      success: true, 
      message: 'OTP sent to your email',
      ...(DEBUG_OTP ? { debug_otp: otp } : {})
    });
  } catch (err) {
    console.error('Email OTP request error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify Email OTP and complete signup
app.post('/api/auth/email-otp/verify', async (req, res) => {
  try {
    const { email, otp, role, name, company_name, phone, age, skills, experience, available_hours, resume_url } = req.body;
    
    if (!email || !otp || !role || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find OTP session
    const otpSession = await database.get(
      `SELECT * FROM otp_sessions WHERE email = ? AND role = ? AND otp_type = 'email' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
      [email, role]
    );

    if (!otpSession) {
      return res.status(400).json({ error: 'OTP expired or not found. Request a new one.' });
    }

    // Check attempts
    if (otpSession.attempt_count >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many failed attempts. Request a new OTP.' });
    }

    // Verify OTP
    if (otpSession.otp_code !== otp) {
      // Increment attempt count
      await database.run(
        `UPDATE otp_sessions SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [otpSession.id]
      );
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // Check if user already exists
    const existingUser = await database.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create new user with auth_method = 'email-otp'
    const approved = role === 'worker' ? 0 : 1; // Workers need admin approval
    
    const result = await database.run(
      `INSERT INTO users (role, email, password_hash, name, company_name, phone, age, skills, experience, available_hours, resume_url, approved, verified, auth_method, verification_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        role,
        email,
        bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10), // Random password hash
        name,
        company_name || null,
        phone || null,
        age ? parseInt(age) : null,
        skills || null,
        experience || null,
        available_hours ? parseInt(available_hours) : null,
        resume_url || null,
        approved,
        1,
        'email-otp',
        crypto.randomBytes(4).toString('hex') // verification code
      ]
    );

    // Delete OTP session
    await database.run('DELETE FROM otp_sessions WHERE id = ?', [otpSession.id]);

    // Generate JWT token
    const user = await database.get('SELECT * FROM users WHERE id = ?', [result.id]);
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: role === 'worker' 
        ? 'Account created successfully! Your profile is awaiting admin approval.'
        : 'Account created successfully! Welcome to codifyx.',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Email OTP verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Email OTP Login (for existing users)
app.post('/api/auth/email-otp/login', async (req, res) => {
  try {
    const { email, role } = req.body;
    
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    // Check if user exists
    const user = await database.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, role]);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Check if user is verified and approved
    if (!user.verified) {
      return res.status(400).json({ error: 'Please verify your email first' });
    }

    if (user.role === 'worker' && !user.approved) {
      return res.status(403).json({ error: 'Your worker account is pending admin approval' });
    }

    // Remove any previous login OTP sessions for this user to avoid stale codes
    await database.run(
      `DELETE FROM otp_sessions WHERE email = ? AND role = ? AND otp_type = 'email'`,
      [email, role]
    );

    // Generate and send OTP for login
    const otp = generateOTP();
    
    await database.run(
      `DELETE FROM otp_sessions WHERE email = ? AND role = ? AND otp_type = 'email'`,
      [email, role]
    );

    await database.run(
      `INSERT INTO otp_sessions (email, otp_code, otp_type, role, created_at, expires_at, attempt_count) 
       VALUES (?, ?, 'email', ?, datetime('now'), datetime('now', '+10 minutes'), 0)`,
      [email, otp, role]
    );

    await sendOTPEmail(email, otp, role);

    res.json({ 
      success: true,
      message: 'Login OTP sent to your email',
      ...(DEBUG_OTP ? { debug_otp: otp } : {})
    });
  } catch (err) {
    console.error('Email OTP login error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify login OTP
app.post('/api/auth/email-otp/login-verify', async (req, res) => {
  try {
    const { email, otp, role } = req.body;
    
    if (!email || !otp || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find OTP session
    const otpSession = await database.get(
      `SELECT * FROM otp_sessions WHERE email = ? AND role = ? AND otp_type = 'email' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
      [email, role]
    );

    if (!otpSession) {
      return res.status(400).json({ error: 'OTP expired or not found' });
    }

    // Check attempts
    if (otpSession.attempt_count >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many failed attempts' });
    }

    // Verify OTP
    if (otpSession.otp_code !== otp) {
      await database.run(
        `UPDATE otp_sessions SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [otpSession.id]
      );
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // Get user
    const user = await database.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, role]);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Delete OTP session
    await database.run('DELETE FROM otp_sessions WHERE id = ?', [otpSession.id]);

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login OTP verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ==========================================
// PHONE OTP ENDPOINTS (for profile completion)
// ==========================================

// Request Phone OTP (for profile completion)
app.post('/api/auth/phone-otp/request', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req.user.id;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Generate OTP
    const otp = generateOTP();
    
    // Save OTP session with phone
    const result = await database.run(
      `INSERT INTO otp_sessions (email, phone, otp_code, otp_type, role, created_at, expires_at, attempt_count) 
       VALUES (?, ?, ?, 'phone', 'worker', datetime('now'), datetime('now', '+10 minutes'), 0)`,
      [req.user.email, phone, otp]
    );

    // Send SMS via Twilio
    const messageBody = `Your codifyx verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
    const smsSent = await sendSMS(phone, messageBody);

    if (!smsSent) {
      // Log to console as fallback for debugging
      console.log(`[Phone OTP] Fallback - To: ${phone}\nOTP Code: ${otp}\nValid for 10 minutes`);
    }

    res.json({ 
      success: true, 
      message: 'OTP sent to your phone',
      request_id: result.id
    });
  } catch (err) {
    console.error('Phone OTP request error:', err);
    res.status(500).json({ error: 'Failed to send phone OTP' });
  }
});

// Verify Phone OTP
app.post('/api/auth/phone-otp/verify', authenticateToken, async (req, res) => {
  try {
    const { otp, request_id } = req.body;
    const userId = req.user.id;

    if (!otp || !request_id) {
      return res.status(400).json({ error: 'OTP and request ID are required' });
    }

    // Find OTP session
    const otpSession = await database.get(
      `SELECT * FROM otp_sessions WHERE id = ? AND otp_type = 'phone' AND expires_at > datetime('now')`,
      [request_id]
    );

    if (!otpSession) {
      return res.status(400).json({ error: 'OTP expired or not found' });
    }

    // Check attempts
    if (otpSession.attempt_count >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many failed attempts' });
    }

    // Verify OTP
    if (otpSession.otp_code !== otp) {
      await database.run(
        `UPDATE otp_sessions SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [request_id]
      );
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // Mark phone as verified and save phone number
    await database.run(
      `UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?`,
      [otpSession.phone, userId]
    );

    // Delete OTP session
    await database.run('DELETE FROM otp_sessions WHERE id = ?', [request_id]);

    res.json({
      success: true,
      message: 'Phone number verified successfully',
      phone_verified: true
    });
  } catch (err) {
    console.error('Phone OTP verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ==========================================
// WORKER PROFILE COMPLETION ENDPOINT
// ==========================================

// Complete Worker Profile (after login)
app.post('/api/auth/worker/complete-profile', authenticateToken, upload.single('resume'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, skills, experience, age, available_hours, phone } = req.body;

    // Verify user is a worker
    const user = await database.get('SELECT role FROM users WHERE id = ?', [userId]);
    if (user.role !== 'worker') {
      return res.status(403).json({ error: 'Only workers can complete profile' });
    }

    // Validate required fields
    if (!first_name || !last_name || !skills || !age || !available_hours || !phone) {
      return res.status(400).json({ error: 'Missing required profile fields' });
    }

    // Handle resume upload
    let resumeUrl = null;
    if (req.file) {
      resumeUrl = `/uploads/${req.file.filename}`;
    } else {
      return res.status(400).json({ error: 'Resume file is required' });
    }

    // Update user profile and automatically set phone_verified to 1
    await database.run(
      `UPDATE users SET name = ?, skills = ?, experience = ?, age = ?, available_hours = ?, resume_url = ?, phone = ?, phone_verified = 1 WHERE id = ?`,
      [
        `${first_name} ${last_name}`,
        skills,
        experience || null,
        parseInt(age),
        parseInt(available_hours),
        resumeUrl,
        phone,
        userId
      ]
    );

    res.json({
      success: true,
      message: 'Profile submitted successfully! Awaiting admin approval.'
    });
  } catch (err) {
    console.error('Worker profile completion error:', err);
    res.status(500).json({ error: 'Profile submission failed' });
  }
});


function runLocalAISuggestions(title, description, budget) {
  const text = (title + ' ' + description).toLowerCase();
  let techStack = ['Node.js', 'SQLite', 'Vanilla CSS'];
  let tasks = [];
  let workersNeeded = 1;
  let estimatedWeeks = 2;

  // Simple, highly effective rule-based analyzer
  if (text.includes('e-commerce') || text.includes('shop') || text.includes('cart') || text.includes('payment')) {
    techStack = ['React', 'Node.js', 'Express', 'SQLite', 'Stripe API'];
    workersNeeded = 3;
    estimatedWeeks = 4;
    tasks = [
      { title: 'Frontend E-Commerce Shell & Layout', description: 'Design landing pages, product catalogs, search systems, and persistent shopping cart layouts.', weight: 0.25 },
      { title: 'Authentication API & Database Setup', description: 'Implement secure JWT user authentication database schemes and user profile structures.', weight: 0.20 },
      { title: 'Product Catalog & Orders API', description: 'Create CRUD endpoints for store inventory management, cart storage, and order logs.', weight: 0.25 },
      { title: 'Stripe Gateway Integration', description: 'Implement real checkout, webhooks processing, receipt generation, and transaction tables.', weight: 0.20 },
      { title: 'End-to-End System Testing & Deployment', description: 'Execute integration tests, load checks, and setup deployment configuration.', weight: 0.10 }
    ];
  } else if (text.includes('chat') || text.includes('messaging') || text.includes('realtime') || text.includes('websocket')) {
    techStack = ['HTML5 WebSockets', 'Node.js', 'Express', 'SQLite'];
    workersNeeded = 2;
    estimatedWeeks = 3;
    tasks = [
      { title: 'Real-time WebSocket server setup', description: 'Build ws communication layers, heartbeat detectors, client caches, and user-room mapping.', weight: 0.35 },
      { title: 'Chat Interface & Styling', description: 'Responsive messaging sidebar layouts, visual lists, auto-scroll grids, and input controls.', weight: 0.25 },
      { title: 'Message Retention & Database Storage', description: 'Build SQLite transaction schemas, fetching unread histories, and pagination endpoints.', weight: 0.30 },
      { title: 'System Load Testing', description: 'Validate simultaneous sockets handling, memory leaks diagnostics, and connection recovery.', weight: 0.10 }
    ];
  } else if (text.includes('ai') || text.includes('gpt') || text.includes('gemini') || text.includes('model') || text.includes('machine learning')) {
    techStack = ['React', 'Node.js', 'Gemini API', 'Vector DB (Chroma)'];
    workersNeeded = 2;
    estimatedWeeks = 3;
    tasks = [
      { title: 'AI Server Wrapper & API Integrations', description: 'Configure OpenAI/Gemini SDKs, system instructions modeling, tokens limiter, and custom prompts wrapper.', weight: 0.40 },
      { title: 'Interactive AI Chat Frontend', description: 'Implement streaming text layout, history panel, markdown renderer, and code snippets syntax highlighter.', weight: 0.30 },
      { title: 'Vector Database & RAG Pipeline', description: 'Build document ingestion scripts, split-chunk algorithms, vector mappings, and semantic retrievals.', weight: 0.20 },
      { title: 'Model Safety & Testing', description: 'Implement prompt injection protections, logging payloads, and accuracy evaluations.', weight: 0.10 }
    ];
  } else {
    // Generic Software Project
    if (text.includes('react')) techStack.unshift('React');
    if (text.includes('mobile') || text.includes('app')) {
      techStack.push('React Native');
      workersNeeded = 2;
      estimatedWeeks = 3;
    }
    tasks = [
      { title: 'Core UI Layout & User Screens', description: 'Build interface pages, CSS grids, navigation menus, and form triggers.', weight: 0.40 },
      { title: 'Backend REST API Services', description: 'Implement Express routers, controller middleware, and database operations.', weight: 0.40 },
      { title: 'Application Testing & Launch', description: 'Test functionality, responsive media checks, and host config setups.', weight: 0.20 }
    ];
  }

  // Calculate costs based on budget weights
  const parsedBudget = parseFloat(budget) || 10000;
  const suggestedTasks = tasks.map((t, idx) => {
    // Distribute payment according to difficulty weight
    const amount = Math.round(parsedBudget * t.weight);
    // Distribute deadlines (sequential timeline helper)
    const daysOffset = Math.round((idx + 1) * (estimatedWeeks * 7 / tasks.length));
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + daysOffset);

    return {
      title: t.title,
      description: t.description,
      payment_amount: amount,
    locked: 0,
    progress: 0,
      deadline: deadlineDate.toISOString().split('T')[0],
      difficulty: amount > 5000 ? 'Hard' : amount > 2000 ? 'Medium' : 'Easy'
    };
  });

  return {
    suggestedTech: techStack.join(', '),
    suggestedWorkers: workersNeeded,
    suggestedWeeks: estimatedWeeks,
    suggestedCost: parsedBudget,
    suggestedTasks
  };
}

// Client requests project creation (triggers AI suggestion inside the response)
app.post('/api/projects', authenticateToken, authorizeRoles('client'), upload.single('projectFile'), async (req, res) => {
  try {
    const { title, description, budget, deadline, technologies } = req.body;
    // Validate required fields
    if (!title || !description || !budget || !deadline) {
      return res.status(400).json({ error: 'Missing core project details (title, description, budget, deadline)' });
    }
    // Parse budget to number
    const parsedBudget = parseFloat(budget);
    if (isNaN(parsedBudget) || parsedBudget <= 0) {
      return res.status(400).json({ error: 'Budget must be a positive number' });
    }
    // Handle optional file upload
    let fileUrl = null;
    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
    }
    // Run AI analysis (fallback to AI suggestion if technologies not provided)
    const aiResult = runLocalAISuggestions(title, description, parsedBudget);
    const techStack = technologies && technologies.trim().length > 0 ? technologies : aiResult.suggestedTech;
    const result = await database.run(
      `INSERT INTO projects (client_id, title, description, budget, deadline, technologies, file_url, status, ai_analysis)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        req.user.id,
        title,
        description,
        parsedBudget,
        deadline,
        techStack,
        fileUrl,
        JSON.stringify(aiResult)
      ]
    );

    // Notify admin via email when client submits project
    const clientUser = await database.get('SELECT name, email, company_name, phone FROM users WHERE id = ?', [req.user.id]);
    const adminUser = await database.get("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
    const emailTo = (adminUser && adminUser.email) ? adminUser.email : ADMIN_EMAIL;
    const clientEmail = clientUser ? clientUser.email : 'N/A';
    const clientPhone = clientUser && clientUser.phone ? clientUser.phone : 'N/A';
    const clientCompany = clientUser && clientUser.company_name ? clientUser.company_name : 'N/A';

    await sendEmail(
      emailTo,
      `📋 New Project Submitted — "${title}"`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f1629;color:#f3f4f6;padding:32px;border-radius:12px;">
        <h2 style="color:#a5b4fc;margin-bottom:8px;">New Project Submitted on codifyx</h2>
        <p style="color:#9ca3af;margin-bottom:24px;">A client submitted a new project awaiting your review.</p>
        <table style="width:100%;border-collapse:collapse;background:#1e2a45;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Project</td><td style="padding:12px 16px;font-weight:600;border-bottom:1px solid #2d3a55;">${title}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Client</td><td style="padding:12px 16px;border-bottom:1px solid #2d3a55;">${clientUser ? clientUser.name : 'N/A'}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Company</td><td style="padding:12px 16px;border-bottom:1px solid #2d3a55;">${clientCompany}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Email</td><td style="padding:12px 16px;border-bottom:1px solid #2d3a55;">${clientEmail}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Phone</td><td style="padding:12px 16px;border-bottom:1px solid #2d3a55;">${clientPhone}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Budget</td><td style="padding:12px 16px;font-weight:700;color:#10b981;border-bottom:1px solid #2d3a55;">&#8377;${parsedBudget.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #2d3a55;">Deadline</td><td style="padding:12px 16px;border-bottom:1px solid #2d3a55;">${deadline}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;">Tech Stack</td><td style="padding:12px 16px;">${techStack}</td></tr>
        </table>
        <div style="margin-top:20px;background:#1e2a45;border-radius:8px;padding:16px;">
          <p style="color:#9ca3af;font-size:13px;margin-bottom:8px;">Description</p>
          <p style="font-size:14px;line-height:1.6;">${description}</p>
        </div>
        <p style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center;">codifyx Platform — Automated Notification</p>
      </div>`
    );

    res.json({
      success: true,
      projectId: result.id,
      message: 'Project submitted successfully! Awaiting admin approval.',
      aiSuggestions: aiResult
    });
  } catch (error) {
    console.error('Project creation error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});



// ==========================================
// 3. CLIENT API
// ==========================================

// Get active and completed projects for logged-in client
app.get('/api/projects/client', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const projects = await database.query('SELECT * FROM projects WHERE client_id = ? ORDER BY id DESC', [req.user.id]);
    
    // Ensure locked column exists in tasks
    await (async () => {
      const taskCols = await database.query(`PRAGMA table_info(tasks)`);
      if (!taskCols.some(c => c.name === 'locked')) {
        try { await database.run(`ALTER TABLE tasks ADD COLUMN locked INTEGER DEFAULT 0`); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
      }
    })();
    for (let p of projects) {
      p.tasks = await database.query('SELECT * FROM tasks WHERE project_id = ?', [p.id]);
      const interestCount = await database.get('SELECT COUNT(*) as cnt FROM project_interest WHERE project_id = ?', [p.id]);
      const teamSize = await database.get('SELECT COUNT(*) as cnt FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id = ?)', [p.id]);
      p.interest_count = interestCount ? interestCount.cnt : 0;
      p.team_size = teamSize ? teamSize.cnt : 0;
    }
    
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch client projects' });
  }
});

// Client updates project budget (typically in response to a revision request)
app.post('/api/projects/:id/revise-budget', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { budget } = req.body;

    const parsedBudget = parseFloat(budget);
    if (isNaN(parsedBudget) || parsedBudget <= 0) {
      return res.status(400).json({ error: 'Budget must be a positive number' });
    }

    const project = await database.get('SELECT * FROM projects WHERE id = ? AND client_id = ?', [projectId, req.user.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Update the budget and set status back to client-revised so admin can re-review/approve/reject
    await database.run(
      `UPDATE projects SET budget = ?, status = 'client-revised' WHERE id = ?`,
      [parsedBudget, projectId]
    );

    // Notify admin via in-app message
    const adminUser = await database.get("SELECT id, email FROM users WHERE role = 'admin' LIMIT 1");
    if (adminUser) {
      const msgText = `[BUDGET REVISED — PROJECT: "${project.title}"]: The budget has been revised to ₹${parsedBudget.toLocaleString('en-IN')}. Please split and approve the project.`;
      const msgResult = await database.run(
        `INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`,
        [
          req.user.id,
          adminUser.id,
          msgText
        ]
      );

      // Broadcast to admin via WebSocket in real time
      const messageObj = {
        id: msgResult.id,
        sender_id: req.user.id,
        receiver_id: adminUser.id,
        message: msgText,
        created_at: new Date().toISOString(),
        is_read: 0
      };
      broadcastMessage(messageObj);

      // Email notifications
      const emailTo = adminUser.email || ADMIN_EMAIL;
      await sendEmail(
        emailTo,
        `🔄 Project Budget Revised — "${project.title}"`,
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f1629;color:#f3f4f6;padding:32px;border-radius:12px;">
          <h2 style="color:#10b981;margin-bottom:8px;">Project Budget Revised</h2>
          <p style="color:#9ca3af;margin-bottom:24px;">The client has revised the budget for "${project.title}" to ₹${parsedBudget.toLocaleString('en-IN')}.</p>
          <p style="color:#9ca3af;">Please log in to the admin panel to review and split the tasks.</p>
        </div>`
      );
    }

    res.json({ success: true, message: 'Project budget revised successfully. Awaiting admin review.' });
  } catch (error) {
    console.error('Revise budget error:', error);
    res.status(500).json({ error: 'Failed to revise project budget' });
  }
});

// Client accepts or rejects revised budget
app.post('/api/projects/:id/accept', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { accept } = req.body;
    const project = await database.get('SELECT * FROM projects WHERE id = ? AND client_id = ?', [projectId, req.user.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (accept) {
      // Calculate worker budget pool
      const workerPool = project.budget - (project.budget * 0.15) - 5000;
      await database.run(
        `UPDATE projects SET status = 'in development', worker_budget_pool = ?, progress = 0, revision_requested_budget = NULL, revision_message = NULL, revision_requested_at = NULL WHERE id = ?`,
        [workerPool, projectId]
      );

      // Auto-populate tasks from AI suggestions if none exist
      const existingTasks = await database.query('SELECT id FROM tasks WHERE project_id = ?', [projectId]);
      if (existingTasks.length === 0) {
        const aiResult = runLocalAISuggestions(project.title, project.description, project.budget);
        const tasks = aiResult.suggestedTasks || [];
        for (let t of tasks) {
          await database.run(
            `INSERT INTO tasks (project_id, title, description, deadline, payment_amount, progress, status, payment_status)
             VALUES (?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
            [projectId, t.title, t.description || '', t.deadline, parseFloat(t.payment_amount)]
          );
        }
      }

      res.json({ success: true, message: 'Project accepted and moved to development.' });
    } else {
      // Revert to pending for another admin revision or client update
      await database.run(
        `UPDATE projects SET status = 'pending', revision_requested_at = NULL WHERE id = ?`,
        [projectId]
      );
      res.json({ success: true, message: 'Project rejected. Awaiting new budget or admin action.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process acceptance.' });
  }
});

// Client cancels a pending project (only allowed if status is 'pending' or 'revision-requested')
app.delete('/api/projects/:id', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await database.get('SELECT * FROM projects WHERE id = ? AND client_id = ?', [projectId, req.user.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.status === 'in development' || project.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a project that is already in development or completed. Contact admin.' });
    }

    // Delete associated tasks first, then the project
    await database.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    await database.run('DELETE FROM projects WHERE id = ?', [projectId]);

    res.json({ success: true, message: 'Project cancelled and removed successfully.' });
  } catch (error) {
    console.error('Cancel project error:', error);
    res.status(500).json({ error: 'Failed to cancel project' });
  }
});

// Get specific project details
app.get('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const project = await database.get('SELECT p.*, u.name as client_name, u.company_name FROM projects p JOIN users u ON p.client_id = u.id WHERE p.id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Validate permission
    if (req.user.role === 'client' && project.client_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized access to this project' });
    }

    const tasks = await database.query(`
      SELECT t.*, u.name as worker_name 
      FROM tasks t 
      LEFT JOIN users u ON t.assigned_worker_id = u.id 
      WHERE t.project_id = ?
    `, [project.id]);

    const interestCount = await database.get('SELECT COUNT(*) as cnt FROM project_interest WHERE project_id = ?', [project.id]);
    const teamSize = await database.get('SELECT COUNT(*) as cnt FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id = ?)', [project.id]);
    project.interest_count = interestCount ? interestCount.cnt : 0;
    project.team_size = teamSize ? teamSize.cnt : 0;

    res.json({ success: true, project, tasks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

// ==========================================
// 4. WORKER API
// ==========================================

// Get available tasks
app.get('/api/tasks/available', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    // Fetch small tasks (<=5k) - direct assignment
    const smallTasks = await database.query(`
      SELECT t.*, p.title as project_title, p.description as project_description 
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id 
      WHERE p.status = 'in development' AND t.payment_amount <= 5000 AND t.assigned_worker_id IS NULL AND t.status = 'pending'
      ORDER BY t.payment_amount DESC
    `);

    // Fetch big tasks (>5k) for claimable big project work
    const bigTasks = await database.query(`
      SELECT t.*, p.title as project_title, p.description as project_description
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE p.project_type = 'big'
        AND (p.status = 'in development' OR p.status = 'team-assigned')
        AND t.assigned_worker_id IS NULL
        AND t.status = 'pending'
        AND t.payment_amount > 5000
      ORDER BY t.payment_amount DESC
    `);

    // Fetch big projects (>5k) with team formation info
    // Only show if 'in development' (team not formed) OR if 'team-assigned' AND worker is in the group.
    const bigProjects = await database.query(`
      SELECT DISTINCT p.id, p.title, p.description, p.budget, p.project_type, p.file_url, p.technologies, p.team_slots,
             (SELECT SUM(payment_amount) FROM tasks WHERE project_id = p.id) as total_payment,
             (SELECT COUNT(*) FROM project_interest WHERE project_id = p.id) as interest_count,
             (SELECT COUNT(*) FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id = p.id)) as team_size,
             (SELECT COUNT(*) FROM project_interest WHERE project_id = p.id AND worker_id = ?) as worker_interested,
             p.status, p.created_at
      FROM projects p
      WHERE p.project_type = 'big' 
        AND (
          p.status = 'in development' 
          OR (
            p.status = 'team-assigned' 
            AND EXISTS (
              SELECT 1 FROM group_members gm
              WHERE gm.group_id IN (SELECT id FROM groups WHERE project_id = p.id)
              AND gm.worker_id = ?
            )
          )
        )
      ORDER BY p.budget DESC
    `, [req.user.id, req.user.id]);

    // Fetch tasks for big projects
    const formattedProjects = await Promise.all(bigProjects.map(async (proj) => {
      const slots = proj.team_slots || 4;
      let tasks = [];
      
      if (proj.status === 'team-assigned') {
        // Team formed - members can see tasks with budget & claim them
        tasks = await database.query(`
          SELECT t.id, t.project_id, t.title, t.description, t.deadline, t.payment_amount, t.working_time, t.progress, t.status
          FROM tasks t
          WHERE t.project_id = ? AND t.assigned_worker_id IS NULL AND t.status = 'pending'
          ORDER BY t.id ASC
        `, [proj.id]);
      } else {
        // Team still forming - show tasks (roles) but hide budgets (amounts)
        const rawTasks = await database.query(`
          SELECT t.id, t.project_id, t.title, t.description, t.deadline, t.working_time, t.progress, t.status
          FROM tasks t
          WHERE t.project_id = ? AND t.status = 'pending'
          ORDER BY t.id ASC
        `, [proj.id]);
        
        // Map to set payment_amount to null (hidden)
        tasks = rawTasks.map(t => ({ ...t, payment_amount: null }));
      }
      
      return { ...proj, available_tasks: tasks };
    }));

    res.json({ 
      success: true, 
      small: smallTasks, 
      big: bigTasks,
      big_projects: formattedProjects 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch available tasks' });
  }
});

// Claim task
app.post('/api/tasks/:id/claim', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await database.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.locked) return res.status(400).json({ error: 'Task is locked for further claims' });
    if (task.assigned_worker_id) {
      return res.status(400).json({ error: 'Task already assigned to a worker' });
    }

    const project = await database.get('SELECT * FROM projects WHERE id = ?', [task.project_id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.project_type === 'big') {
      const group = await database.get('SELECT * FROM groups WHERE project_id = ?', [task.project_id]);
      if (!group) {
        return res.status(400).json({ error: 'Group team has not been formed yet' });
      }

      const isMember = await database.get('SELECT 1 FROM group_members WHERE group_id = ? AND worker_id = ?', [group.id, req.user.id]);
      if (!isMember) {
        return res.status(403).json({ error: 'You are not a member of this project group team' });
      }

      const alreadyClaimed = await database.get('SELECT 1 FROM tasks WHERE project_id = ? AND assigned_worker_id = ?', [task.project_id, req.user.id]);
      if (alreadyClaimed) {
        return res.status(400).json({ error: 'You have already claimed a milestone task in this project group' });
      }
    }

    // Assign worker
    await database.run(
      `UPDATE tasks SET assigned_worker_id = ?, status = 'assigned', progress = 10, group_id = (SELECT id FROM groups WHERE project_id = ?) WHERE id = ?`,
      [req.user.id, task.project_id, taskId]
    );

    res.json({ success: true, message: 'Task claimed successfully! Get started on it in your Assigned Tasks panel.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to claim task' });
  }
});

// Get assigned tasks
app.get('/api/tasks/assigned', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const tasks = await database.query(`
      SELECT t.*, p.title as project_title, p.description as project_description, p.file_url as project_file_url, p.technologies
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id 
      WHERE t.assigned_worker_id = ? 
      ORDER BY t.id DESC
    `, [req.user.id]);
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assigned tasks' });
  }
});

// Submit code/task complete
app.post('/api/tasks/:id/submit', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const { code_submission, progress } = req.body;
    const taskId = req.params.id;

    const task = await database.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.assigned_worker_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to submit code for this task' });
    }

    // Set to 'review' once worker marks completed (represented by progress = 100)
    const newStatus = parseInt(progress) === 100 ? 'review' : 'in progress';

    await database.run(
      `UPDATE tasks SET progress = ?, code_submission = ?, status = ? WHERE id = ?`,
      [parseInt(progress), code_submission || '', newStatus, taskId]
    );

    res.json({ success: true, message: newStatus === 'review' ? 'Task submitted for admin review!' : 'Task progress updated.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// Worker Help request
app.post('/api/tasks/:id/help', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { message } = req.body;
    const task = await database.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Send automated help notice message from this worker to Admin
    const adminUser = await database.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (adminUser) {
      await database.run(
        `INSERT INTO messages (sender_id, receiver_id, message) 
         VALUES (?, ?, ?)`,
        [req.user.id, adminUser.id, `[SYSTEM HELP REQUEST - TASK #${taskId} - ${task.title}]: ${message}`]
      );
    }

    res.json({ success: true, message: 'Help request successfully dispatched to administrative team.' });
  } catch (error) {
    res.status(500).json({ error: 'Request help failed' });
  }
});

// Worker Earnings
app.get('/api/worker/earnings', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const earnings = await database.query(`
      SELECT t.title, t.payment_amount, t.payment_status, p.title as project_title, t.created_at 
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.assigned_worker_id = ? AND t.status = 'completed'
    `, [req.user.id]);

    const approvedTotal = await database.get(`
      SELECT SUM(payment_amount) as total FROM tasks 
      WHERE assigned_worker_id = ? AND payment_status = 'approved' AND status = 'completed'
    `, [req.user.id]);

    const pendingTotal = await database.get(`
      SELECT SUM(payment_amount) as total FROM tasks 
      WHERE assigned_worker_id = ? AND payment_status = 'pending' AND status = 'completed'
    `, [req.user.id]);

    res.json({
      success: true,
      history: earnings,
      totalEarnings: approvedTotal.total || 0,
      pendingPayments: pendingTotal.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch financial balance' });
  }
});

// Worker Performance
app.get('/api/worker/performance', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const stats = await database.get(`
      SELECT COUNT(*) as completed_count FROM tasks 
      WHERE assigned_worker_id = ? AND status = 'completed'
    `, [req.user.id]);

    // Mock evaluations
    res.json({
      success: true,
      completedTasks: stats.completed_count || 0,
      rating: stats.completed_count > 5 ? 4.9 : stats.completed_count > 1 ? 4.7 : 4.5,
      accuracyScore: stats.completed_count > 3 ? 98 : 94
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Worker Training Modules
app.get('/api/worker/training', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const modules = await database.query('SELECT * FROM training_modules');
    const progress = await database.query('SELECT * FROM worker_progress WHERE worker_id = ?', [req.user.id]);

    // Map progress to modules
    const modulesWithStatus = modules.map(m => {
      const prog = progress.find(p => p.module_id === m.id);
      return {
        ...m,
        completed: prog ? prog.completed : 0,
        quiz_score: prog ? prog.quiz_score : null,
        badge_awarded: prog ? prog.badge_awarded : 0
      };
    });

    res.json({ success: true, modules: modulesWithStatus });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load training portal' });
  }
});

// Worker submits quiz
app.post('/api/worker/training/:id/quiz', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const moduleId = req.params.id;
    const { answers } = req.body; // Array of option indexes corresponding to questions

    const moduleItem = await database.get('SELECT * FROM training_modules WHERE id = ?', [moduleId]);
    if (!moduleItem) return res.status(404).json({ error: 'Module not found' });

    const questions = JSON.parse(moduleItem.quiz_json);
    let correctCount = 0;

    questions.forEach((q, index) => {
      if (answers[index] === q.a) {
        correctCount++;
      }
    });

    const scorePercent = Math.round((correctCount / questions.length) * 100);
    const badgeAwarded = scorePercent >= 80 ? 1 : 0;

    // Save progress to DB
    await database.run(`
      INSERT INTO worker_progress (worker_id, module_id, completed, quiz_score, badge_awarded)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(worker_id, module_id) DO UPDATE SET
        completed = 1,
        quiz_score = MAX(quiz_score, ?),
        badge_awarded = MAX(badge_awarded, ?)
    `, [req.user.id, moduleId, scorePercent, badgeAwarded, scorePercent, badgeAwarded]);

    res.json({
      success: true,
      score: scorePercent,
      correctAnswers: correctCount,
      totalQuestions: questions.length,
      badgeAwarded: badgeAwarded === 1,
      message: badgeAwarded === 1 
        ? 'Congratulations! You passed and earned a training badge!' 
        : 'Score too low (needs >= 80% to earn badge). Review content and try again.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// ==========================================
// 5. ADMIN API
// ==========================================

// Get pending workers
app.get('/api/admin/workers/pending', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const workers = await database.query("SELECT id, name, email, skills, resume_url, experience, available_hours FROM users WHERE role = 'worker' AND approved = 0");
    res.json({ success: true, workers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load pending workers' });
  }
});

// Approve/Reject Worker
app.post('/api/admin/workers/:id/approve', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const workerId = req.params.id;

    if (action === 'approve') {
      await database.run('UPDATE users SET approved = 1 WHERE id = ?', [workerId]);
      res.json({ success: true, message: 'Worker registration approved successfully.' });
    } else {
      await database.run('DELETE FROM users WHERE id = ?', [workerId]);
      res.json({ success: true, message: 'Worker registration rejected and profile removed.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update worker status' });
  }
});

// -------------------------------------------------
// 5b. ADMIN - RESEND PROJECT REQUEST (e.g., budget low)
// -------------------------------------------------
app.post('/api/admin/projects/:id/resend', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await database.get('SELECT p.*, u.email as client_email, u.name as client_name FROM projects p JOIN users u ON p.client_id = u.id WHERE p.id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Re‑send email to client with current project details
    await sendEmail(
      project.client_email,
      `🔔 Reminder: Project "${project.title}" Needs Your Attention`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f1629;color:#f3f4f6;padding:32px;border-radius:12px;">
        <h2 style="color:#a5b4fc;margin-bottom:8px;">Project Reminder</h2>
        <p style="color:#9ca3af;margin-bottom:24px;">Your project "${project.title}" is awaiting admin action (e.g., budget confirmation). Please review the details below and respond.</p>
        <table style="width:100%;border-collapse:collapse;background:#1e2a45;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;">Title</td><td style="padding:12px 16px;font-weight:600;">${project.title}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;">Budget</td><td style="padding:12px 16px;font-weight:700;color:#10b981;">&#8377;${project.budget.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;">Deadline</td><td style="padding:12px 16px;">${project.deadline}</td></tr>
          <tr><td style="padding:12px 16px;color:#9ca3af;font-size:13px;">Tech Stack</td><td style="padding:12px 16px;">${project.technologies}</td></tr>
        </table>
        <p style="margin-top:20px;color:#9ca3af;font-size:13px;">If you need to adjust the budget, please use the platform's budget revision flow.</p>
        <p style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center;">codifyx Platform – Automated Notification</p>
      </div>`
    );
    res.json({ success: true, message: 'Reminder email resent to client.' });
  } catch (error) {
    console.error('Admin resend error:', error);
    res.status(500).json({ error: 'Failed to resend project email' });
  }
});

// -------------------------------------------------
// 5c. WORKER GROUP MANAGEMENT ENDPOINTS
// -------------------------------------------------
// Create a new group (client can also create via admin UI)
app.post('/api/worker/group', authenticateToken, authorizeRoles('admin', 'client'), async (req, res) => {
  try {
    const { name, client_id } = req.body; // client_id optional, admin can omit
    const result = await database.run(`INSERT INTO groups (name, client_id) VALUES (?, ?)`, [name, client_id || null]);
    res.json({ success: true, groupId: result.id, message: 'Group created.' });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Add member(s) to a group
app.post('/api/worker/group/:groupId/members', authenticateToken, authorizeRoles('admin', 'client'), async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const { workerIds } = req.body; // array of worker user IDs
    if (!Array.isArray(workerIds) || workerIds.length === 0) {
      return res.status(400).json({ error: 'workerIds must be a non‑empty array' });
    }
    const placeholders = workerIds.map(() => '(?, ?)').join(', ');
    const values = [];
    workerIds.forEach(id => { values.push(groupId, id); });
    await database.run(`INSERT OR IGNORE INTO group_members (group_id, worker_id) VALUES ${placeholders}`, values);
    // Determine leader: highest experience_years among members
    const leader = await database.get(`
      SELECT u.id FROM users u 
      JOIN group_members gm ON gm.worker_id = u.id 
      WHERE gm.group_id = ? ORDER BY u.experience_years DESC LIMIT 1
    `, [groupId]);
    if (leader) {
      // Reset previous leaders
      await database.run(`UPDATE group_members SET is_leader = 0 WHERE group_id = ?`, [groupId]);
      await database.run(`UPDATE group_members SET is_leader = 1 WHERE group_id = ? AND worker_id = ?`, [groupId, leader.id]);
    }
    res.json({ success: true, message: 'Members added and leader assigned.' });
  } catch (error) {
    console.error('Add members error:', error);
    res.status(500).json({ error: 'Failed to add members to group' });
  }
});

// Get all groups with members and leader info
app.get('/api/worker/groups', authenticateToken, authorizeRoles('admin', 'client'), async (req, res) => {
  try {
    const groups = await database.query('SELECT * FROM groups');
    for (let g of groups) {
      const members = await database.query(`
        SELECT u.id, u.name, u.experience_years, gm.is_leader FROM group_members gm 
        JOIN users u ON gm.worker_id = u.id WHERE gm.group_id = ?
      `, [g.id]);
      g.members = members;
    }
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Fetch groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Worker retrieves list of all groups they belong to (assigned workspaces)
app.get('/api/worker/my-groups', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const workerId = req.user.id;
    // Get groups where the worker is a member
    const groups = await database.query(`
      SELECT g.id, g.name, g.description, g.leader_id, g.project_id,
             p.title as project_title, p.description as project_description, p.file_url as project_file_url, p.technologies, p.budget as project_budget
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      JOIN projects p ON g.project_id = p.id
      WHERE gm.worker_id = ?
      ORDER BY g.id DESC
    `, [workerId]);

    const resultGroups = [];
    for (const grp of groups) {
      // Get all members of the group
      const members = await database.query(`
        SELECT u.id, u.name, u.email, u.skills, gm.is_leader,
               EXISTS(SELECT 1 FROM core_members cm WHERE cm.worker_id = u.id) as is_core
        FROM group_members gm
        JOIN users u ON gm.worker_id = u.id
        WHERE gm.group_id = ?
      `, [grp.id]);

      // Get milestone tasks for this group/project
      const tasks = await database.query(`
        SELECT t.id, t.title, t.description, t.deadline, t.payment_amount, t.working_time, t.progress, t.status, t.assigned_worker_id,
               u.name as assigned_worker_name
        FROM tasks t
        LEFT JOIN users u ON t.assigned_worker_id = u.id
        WHERE t.project_id = ?
      `, [grp.project_id]);

      resultGroups.push({
        ...grp,
        members,
        tasks
      });
    }

    res.json({ success: true, groups: resultGroups });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve worker groups' });
  }
});

// -------------------------------------------------
// 5d. AI‑DRIVEN WORKER SUGGESTION ENDPOINT
// -------------------------------------------------
app.get('/api/worker/suggest/:projectId', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await database.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Simple keyword matching between project description and worker resume_text
    const workers = await database.query('SELECT id, name, email, resume_text, experience_years FROM users WHERE role = "worker" AND approved = 1');
    const text = (project.title + ' ' + project.description).toLowerCase();
    const suggestions = workers.map(w => {
      const resume = (w.resume_text || '').toLowerCase();
      const matchScore = (text.split(' ').filter(t => resume.includes(t)).length);
      return { id: w.id, name: w.name, email: w.email, experience_years: w.experience_years, matchScore };
    }).filter(s => s.matchScore > 0)
      .sort((a, b) => b.experience_years - a.experience_years || b.matchScore - a.matchScore);

    res.json({ success: true, suggestions });
  } catch (error) {
    console.error('Worker suggestion error:', error);
    res.status(500).json({ error: 'Failed to generate worker suggestions' });
  }
});

// Get all projects for Admin console
app.get('/api/admin/projects', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projects = await database.query(`
      SELECT p.*, u.name as client_name, u.company_name 
      FROM projects p 
      JOIN users u ON p.client_id = u.id 
      ORDER BY p.id DESC
    `);

    for (let p of projects) {
      p.tasks = await database.query(`
        SELECT t.*, u.name as worker_name 
        FROM tasks t 
        LEFT JOIN users u ON t.assigned_worker_id = u.id 
        WHERE t.project_id = ?
      `, [p.id]);

      const interestCount = await database.get('SELECT COUNT(*) as cnt FROM project_interest WHERE project_id = ?', [p.id]);
      const teamSize = await database.get('SELECT COUNT(*) as cnt FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id = ?)', [p.id]);
      p.interest_count = interestCount ? interestCount.cnt : 0;
      p.team_size = teamSize ? teamSize.cnt : 0;
    }

    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin projects list' });
  }
});

// Approve/Reject Client Project
app.post('/api/admin/projects/:id/status', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { status } = req.body; // 'in development' (approve) or 'rejected'
    const projectId = req.params.id;

    if (status === 'in development') {
      await database.run("UPDATE projects SET status = 'in development' WHERE id = ?", [projectId]);
      res.json({ success: true, message: 'Project approved! The project is now open for task claims.' });
    } else {
      await database.run("UPDATE projects SET status = 'completed' WHERE id = ?", [projectId]); // Closing it
      res.json({ success: true, message: 'Project closed or archived.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project status' });
  }
});

// Admin cancel/delete a project (any status)
app.delete('/api/admin/projects/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await database.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Delete associated tasks and messages, then project
    await database.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    await database.run('DELETE FROM projects WHERE id = ?', [projectId]);

    res.json({ success: true, message: 'Project and all associated tasks have been cancelled and removed.' });
  } catch (error) {
    console.error('Admin delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Split project into tasks manually or reviewing AI split
app.post('/api/admin/projects/:id/split', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { tasks, team_slots } = req.body; // Array of { title, description, deadline, payment_amount, working_time }

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks data missing or malformed' });
    }

    // Clear any pre-existing split tasks first (if re-splitting)
    await database.run("DELETE FROM tasks WHERE project_id = ?", [projectId]);

    // Insert each task including working_time
    for (let t of tasks) {
      await database.run(
        `INSERT INTO tasks (project_id, title, description, deadline, payment_amount, working_time, progress, status, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
        [projectId, t.title, t.description || '', t.deadline, parseFloat(t.payment_amount), t.working_time || '20 hours']
      );
    }

    // Update status to 'in development' and update team slots limit (default 4)
    const slots = parseInt(team_slots) || 4;
    await database.run(
      "UPDATE projects SET status = 'in development', team_slots = ? WHERE id = ?",
      [slots, projectId]
    );

    res.json({ success: true, message: 'Project split into tasks and approved for active development!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to split project tasks' });
  }
});

// Admin requests budget revision from client
app.post('/api/admin/projects/:id/request-revision', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { message, requestedBudget } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Revision message is required' });
    }

    const project = await database.get('SELECT p.*, u.name as client_name, u.email as client_email FROM projects p JOIN users u ON p.client_id = u.id WHERE p.id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const adminUser = await database.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    // Send in-app system message to the client
    const budgetNote = requestedBudget ? ` Requested revised budget: ₹${parseFloat(requestedBudget).toLocaleString('en-IN')}.` : '';
    const revMsgText = `[BUDGET REVISION REQUEST — PROJECT: "${project.title}"]: ${message}${budgetNote} Please update your project budget to proceed.`;
    const revMsgResult = await database.run(
      `INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`,
      [adminUser.id, project.client_id, revMsgText]
    );

    // Broadcast to client via WebSocket in real time
    broadcastMessage({
      id: revMsgResult.id,
      sender_id: adminUser.id,
      receiver_id: project.client_id,
      message: revMsgText,
      created_at: new Date().toISOString(),
      is_read: 0
    });

    // Mark project as needing revision and store request details
    await database.run(
      `UPDATE projects SET status = 'revision-requested', revision_requested_budget = ?, revision_message = ?, revision_requested_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [requestedBudget || null, message, projectId]
    );

    // Send email notification to client
    await sendEmail(
      project.client_email,
      `⚠️ Budget Revision Requested — "${project.title}"`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f1629;color:#f3f4f6;padding:32px;border-radius:12px;">
        <h2 style="color:#f59e0b;margin-bottom:8px;">Budget Revision Requested</h2>
        <p style="color:#9ca3af;margin-bottom:16px;">The codifyx admin team has reviewed your project and is requesting a budget revision before it can proceed.</p>
        <div style="background:#1e2a45;border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid #f59e0b;">
          <p style="color:#9ca3af;font-size:13px;margin-bottom:6px;">Project</p>
          <p style="font-weight:600;margin-bottom:12px;">${project.title}</p>
          <p style="color:#9ca3af;font-size:13px;margin-bottom:6px;">Admin Message</p>
          <p style="line-height:1.6;">${message}</p>
          ${requestedBudget ? `<p style="margin-top:12px;color:#10b981;font-weight:600;">Requested Budget: &#8377;${parseFloat(requestedBudget).toLocaleString('en-IN')}</p>` : ''}
        </div>
        <p style="color:#9ca3af;font-size:14px;">Please log in to your dashboard and update the project budget to continue.</p>
        <p style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center;">codifyx Platform — Automated Notification</p>
      </div>`
    );

    res.json({ success: true, message: 'Budget revision request sent to client via message and email.' });
  } catch (error) {
    console.error('Budget revision error:', error);
    res.status(500).json({ error: 'Failed to send revision request' });
  }
});

// Admin accepts a client's revised budget — moves project back to 'pending' for split/approve
app.post('/api/admin/projects/:id/accept-revised-budget', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await database.get(
      'SELECT p.*, u.name as client_name, u.email as client_email, u.id as client_user_id FROM projects p JOIN users u ON p.client_id = u.id WHERE p.id = ?',
      [projectId]
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const adminUser = await database.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    // Mark project as pending (admin-reviewed and accepted), clear revision flags
    await database.run(
      `UPDATE projects SET status = 'pending', revision_requested_budget = NULL, revision_message = NULL, revision_requested_at = NULL WHERE id = ?`,
      [projectId]
    );

    // Notify client via in-app message
    const notifyMsg = `[BUDGET ACCEPTED — PROJECT: "${project.title}"]: Admin has accepted your revised budget of ₹${parseFloat(project.budget).toLocaleString('en-IN')}. Your project is now under admin review for task splitting.`;
    const msgResult = await database.run(
      `INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`,
      [adminUser.id, project.client_id, notifyMsg]
    );

    const messageObj = {
      id: msgResult.id,
      sender_id: adminUser.id,
      receiver_id: project.client_id,
      message: notifyMsg,
      created_at: new Date().toISOString(),
      is_read: 0
    };
    broadcastMessage(messageObj);

    res.json({ success: true, message: 'Revised budget accepted. Project is now pending admin review.' });
  } catch (error) {
    console.error('Accept revised budget error:', error);
    res.status(500).json({ error: 'Failed to accept revised budget' });
  }
});

// Admin rejects client's revised budget
app.post('/api/admin/projects/:id/reject-revised-budget', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { reason } = req.body;
    const project = await database.get(
      'SELECT p.*, u.name as client_name, u.email as client_email FROM projects p JOIN users u ON p.client_id = u.id WHERE p.id = ?',
      [projectId]
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const adminUser = await database.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    // Revert project back to revision-requested
    await database.run(
      `UPDATE projects SET status = 'revision-requested', revision_message = ? WHERE id = ?`,
      [reason || 'Revised budget rejected by admin. Please propose another amount.', projectId]
    );

    // Notify client via in-app message
    const notifyMsg = `[BUDGET REJECTED — PROJECT: "${project.title}"]: Admin has rejected your revised budget. Reason: ${reason || 'Please propose another amount.'}`;
    const msgResult = await database.run(
      `INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`,
      [adminUser.id, project.client_id, notifyMsg]
    );

    const messageObj = {
      id: msgResult.id,
      sender_id: adminUser.id,
      receiver_id: project.client_id,
      message: notifyMsg,
      created_at: new Date().toISOString(),
      is_read: 0
    };
    broadcastMessage(messageObj);

    res.json({ success: true, message: 'Revised budget rejected. Client has been notified.' });
  } catch (error) {
    console.error('Reject revised budget error:', error);
    res.status(500).json({ error: 'Failed to reject revised budget' });
  }
});

// Assign task directly to worker
app.post('/api/admin/tasks/:id/assign', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { workerId } = req.body;

    const worker = await database.get("SELECT id FROM users WHERE id = ? AND role = 'worker' AND approved = 1", [workerId]);
    if (!worker) return res.status(400).json({ error: 'Worker not found or not approved yet' });

    await database.run(
      `UPDATE tasks SET assigned_worker_id = ?, status = 'assigned', progress = 10 WHERE id = ?`,
      [workerId, taskId]
    );

    res.json({ success: true, message: 'Task assigned successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// Approve Worker Code & Payment Release
app.post('/api/admin/tasks/:id/approve-payment', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const taskId = req.params.id;
    await database.run(
      `UPDATE tasks SET status = 'completed', payment_status = 'approved', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [taskId]
    );

    // Get project id to check if all tasks are complete
    const task = await database.get('SELECT project_id FROM tasks WHERE id = ?', [taskId]);
    if (task) {
      // Check total tasks and completed tasks for project
      const stats = await database.get(`
        SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed 
        FROM tasks 
        WHERE project_id = ?
      `, [task.project_id]);

      // Update project progress
      const projectProgress = Math.round((stats.completed / stats.total) * 100);
      if (projectProgress === 100) {
        await database.run("UPDATE projects SET status = 'completed' WHERE id = ?", [task.project_id]);
      }
    }

    res.json({ success: true, message: 'Code and payment approved. Payment released to worker balance.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to approve payment' });
  }
});

// Reject Code submission (returns task to 'in progress')
app.post('/api/admin/tasks/:id/reject-payment', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { reason } = req.body;

    await database.run(
      `UPDATE tasks SET status = 'in progress', progress = 50, payment_status = 'rejected' WHERE id = ?`,
      [taskId]
    );

    // Get assigned worker and notify them via system message
    const task = await database.get('SELECT assigned_worker_id, title FROM tasks WHERE id = ?', [taskId]);
    if (task && task.assigned_worker_id) {
      const adminUser = await database.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      await database.run(
        `INSERT INTO messages (sender_id, receiver_id, message) 
         VALUES (?, ?, ?)`,
        [adminUser.id, task.assigned_worker_id, `[SYSTEM ALERT - CODE REJECTED - TASK #${taskId} - ${task.title}]: ${reason || 'Code requires revision. Please check and re-submit.'}`]
      );
    }

    res.json({ success: true, message: 'Submission rejected. Task returned to worker for revision.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject submission' });
  }
});

// Admin Analytics
app.get('/api/admin/analytics', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const totalRevenueRow = await database.get("SELECT SUM(budget) as total FROM projects WHERE status != 'rejected'");
    const activeWorkersRow = await database.get("SELECT COUNT(*) as count FROM users WHERE role = 'worker' AND approved = 1");
    const activeProjectsRow = await database.get("SELECT COUNT(*) as count FROM projects WHERE status = 'in development'");
    
    // Profit calculated as 15% platform commission
    const revenue = totalRevenueRow.total || 0;
    const profit = Math.round(revenue * 0.15);

    res.json({
      success: true,
      totalRevenue: revenue,
      activeWorkers: activeWorkersRow.count,
      activeProjects: activeProjectsRow.count,
      monthlyProfit: profit
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

// Admin Reports (worker details and project list)
app.get('/api/admin/reports', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const workersReport = await database.query(`
      SELECT u.id, u.name, u.email, u.skills, 
             SUM(CASE WHEN t.payment_status = 'approved' THEN t.payment_amount ELSE 0 END) as total_earned,
             COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks
      FROM users u
      LEFT JOIN tasks t ON u.id = t.assigned_worker_id
      WHERE u.role = 'worker' AND u.approved = 1
      GROUP BY u.id
    `);

    res.json({
      success: true,
      workersReport
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Admin retrieves list of all approved workers for direct manual task assignment
app.get('/api/admin/workers/approved', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const workers = await database.query("SELECT id, name, email, skills FROM users WHERE role = 'worker' AND approved = 1");
    res.json({ success: true, workers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load approved workers' });
  }
});

// Admin retrieves a worker's detailed profile and statistics
app.get('/api/admin/workers/:id/profile-stats', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const workerId = req.params.id;
    const worker = await database.get(
      'SELECT id, name, email, phone, age, skills, experience, available_hours, approved, verified FROM users WHERE id = ? AND role = ?',
      [workerId, 'worker']
    );
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Aggregate statistics from tasks
    const stats = await database.get(`
      SELECT 
        COUNT(*) as total_assigned,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'completed' AND (completed_at IS NULL OR completed_at <= deadline) THEN 1 ELSE 0 END) as on_time,
        SUM(CASE WHEN payment_status = 'approved' THEN payment_amount ELSE 0 END) as total_earned
      FROM tasks
      WHERE assigned_worker_id = ?
    `, [workerId]);

    // Average rating
    const ratingRow = await database.get(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
      FROM reviews
      WHERE to_user_id = ?
    `, [workerId]);

    // List of completed tasks with projects
    const completedTasks = await database.query(`
      SELECT t.id, t.title, t.payment_amount, t.deadline, t.completed_at, p.title as project_title
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.assigned_worker_id = ? AND t.status = 'completed'
      ORDER BY t.completed_at DESC
    `, [workerId]);

    // Check if worker is a core member
    const coreMember = await database.get('SELECT id FROM core_members WHERE worker_id = ?', [workerId]);

    res.json({
      success: true,
      worker,
      stats: {
        total_assigned: stats.total_assigned || 0,
        completed: stats.completed || 0,
        on_time: stats.on_time || 0,
        total_earned: stats.total_earned || 0,
        avg_rating: ratingRow.avg_rating || null,
        review_count: ratingRow.review_count || 0,
        is_core: !!coreMember
      },
      completed_tasks: completedTasks
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch worker profile statistics' });
  }
});

// ============ TEAM MANAGEMENT APIs ============

// Worker expresses interest in big project
app.post('/api/projects/:id/express-interest', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const workerId = req.user.id;

    const project = await database.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.project_type !== 'big') return res.status(400).json({ error: 'Only big projects accept team interest' });
    if (project.status === 'team-assigned') return res.status(400).json({ error: 'A team has already been assigned to this project' });

    // Check if already interested
    const existing = await database.get('SELECT id FROM project_interest WHERE project_id = ? AND worker_id = ?', [projectId, workerId]);
    if (existing) return res.status(400).json({ error: 'You already expressed interest in this project' });

    // Insert interest
    await database.run('INSERT INTO project_interest (project_id, worker_id) VALUES (?, ?)', [projectId, workerId]);

    // Check if this is the N-th interest expression (N = team_slots)
    const slots = project.team_slots || 4;
    const interestCount = await database.get('SELECT COUNT(*) as cnt FROM project_interest WHERE project_id = ?', [projectId]);
    
    if (interestCount.cnt === slots) {
      // Fetch interested workers up to the limit
      const interested = await database.query(
        'SELECT worker_id FROM project_interest WHERE project_id = ? ORDER BY interested_at ASC LIMIT ?',
        [projectId, slots]
      );
      
      // Select the leader from interested core members if possible, otherwise fallback to the first interested worker
      const interestedIds = interested.map(w => w.worker_id);
      let leaderId = interested[0].worker_id; // Default fallback

      if (interestedIds.length > 0) {
        const coreLead = await database.get(
          `SELECT worker_id FROM core_members WHERE worker_id IN (${interestedIds.join(',')}) LIMIT 1`
        );
        if (coreLead) {
          leaderId = coreLead.worker_id;
        }
      }

      const groupResult = await database.run(
        `INSERT INTO groups (name, client_id, leader_id, project_id, description) VALUES (?, ?, ?, ?, ?)`,
        [
          `Project ${projectId} Team`,
          project.client_id,
          leaderId,
          projectId,
          'Automatically formed team for big project'
        ]
      );

      const groupId = groupResult.id;

      // Link project's tasks to this new group
      await database.run('UPDATE tasks SET group_id = ? WHERE project_id = ?', [groupId, projectId]);

      // Add all workers to group and mark leader
      for (const worker of interested) {
        const isLeader = worker.worker_id === leaderId ? 1 : 0;
        await database.run(
          'INSERT INTO group_members (group_id, worker_id, is_leader) VALUES (?, ?, ?)',
          [groupId, worker.worker_id, isLeader]
        );
      }

      // Lock the project from further interest expressions
      await database.run('UPDATE projects SET status = ? WHERE id = ?', ['team-assigned', projectId]);

      // Create invites for the other members (exclude leader)
      for (const worker of interested) {
        if (worker.worker_id !== leaderId) {
          await database.run(
            `INSERT INTO group_invites (group_id, worker_id, status) VALUES (?, ?, ?)`,
            [groupId, worker.worker_id, 'pending']
          );
        }
      }

      return res.json({ 
        success: true, 
        message: `Team formed with ${slots} members! You have been assigned to this project.` 
      });
    }

    res.json({ 
      success: true, 
      message: `Interest registered! (${interestCount.cnt}/${slots} workers interested)` 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to express interest' });
  }
});

// Get interested workers for a project (admin view)
app.get('/api/projects/:id/interested-workers', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const projectId = req.params.id;
    const workers = await database.query(`
      SELECT u.id, u.name, u.email, u.skills, pi.interested_at,
             (SELECT COUNT(*) FROM tasks WHERE assigned_worker_id = u.id AND payment_status = 'approved') as completed_tasks
      FROM project_interest pi
      JOIN users u ON pi.worker_id = u.id
      WHERE pi.project_id = ?
      ORDER BY pi.interested_at ASC
    `, [projectId]);

    res.json({ success: true, interested_workers: workers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch interested workers' });
  }
});

// Get core members list (admin)
app.get('/api/admin/core-members', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const members = await database.query(`
      SELECT cm.id, u.id as worker_id, u.name, u.email, u.skills, cm.promoted_at,
             (SELECT COUNT(*) FROM tasks WHERE assigned_worker_id = u.id AND payment_status = 'approved') as completed_tasks
      FROM core_members cm
      JOIN users u ON cm.worker_id = u.id
      ORDER BY cm.promoted_at DESC
    `);

    res.json({ success: true, core_members: members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch core members' });
  }
});

// Promote worker to core member status (admin)
app.post('/api/admin/promote-worker', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { worker_id, reason } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

    const worker = await database.get('SELECT id FROM users WHERE id = ? AND role = ?', [worker_id, 'worker']);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Check if already core member
    const exists = await database.get('SELECT id FROM core_members WHERE worker_id = ?', [worker_id]);
    if (exists) return res.status(400).json({ error: 'Worker already a core member' });

    // Promote
    await database.run('INSERT INTO core_members (worker_id, promotion_reason) VALUES (?, ?)', [worker_id, reason || 'Promoted by admin']);

    res.json({ success: true, message: 'Worker promoted to core member' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to promote worker' });
  }
});

// Demote worker from core member status (admin)
app.post('/api/admin/demote-worker', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { worker_id } = req.body;
    if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

    // Remove from core members table
    await database.run('DELETE FROM core_members WHERE worker_id = ?', [worker_id]);

    res.json({ success: true, message: 'Worker demoted from core member' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to demote worker' });
  }
});

// Accept/Decline team invite (worker)
app.post('/api/invites/:id/:action', authenticateToken, authorizeRoles('worker'), async (req, res) => {
  try {
    const inviteId = req.params.id;
    const action = req.params.action; // 'accept' or 'decline'

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or decline' });
    }

    const invite = await database.get('SELECT * FROM group_invites WHERE id = ? AND invited_worker_id = ?', [inviteId, req.user.id]);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.status !== 'pending') return res.status(400).json({ error: 'Invite already ' + invite.status });

    await database.run('UPDATE group_invites SET status = ? WHERE id = ?', [action === 'accept' ? 'accepted' : 'declined', inviteId]);

    if (action === 'accept') {
      // If declining, the system should auto-promote next interested worker (future feature)
      res.json({ success: true, message: 'You accepted the team invite!' });
    } else {
      res.json({ success: true, message: 'You declined the team invite' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to respond to invite' });
  }
});

// ==========================================
// 6. REAL-TIME MESSAGING API
// ==========================================

// Get chat partners based on role
app.get('/api/messages/contacts', authenticateToken, async (req, res) => {
  try {
    let contacts = [];
    if (req.user.role === 'admin') {
      // Admins talk to everyone (clients & workers)
      contacts = await database.query("SELECT id, name, role, email FROM users WHERE id != ? ORDER BY name ASC", [req.user.id]);
    } else {
      // Clients and workers can only talk to admins
      contacts = await database.query("SELECT id, name, role, email FROM users WHERE role = 'admin' ORDER BY name ASC");
    }
    res.json({ success: true, contacts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// Get message history with a user
app.get('/api/messages/history/:contactId', authenticateToken, async (req, res) => {
  try {
    const contactId = req.params.contactId;
    const history = await database.query(`
      SELECT m.*, u_send.name as sender_name, u_recv.name as receiver_name 
      FROM messages m
      JOIN users u_send ON m.sender_id = u_send.id
      JOIN users u_recv ON m.receiver_id = u_recv.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) 
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.id ASC
    `, [req.user.id, contactId, contactId, req.user.id]);

    // Mark as read
    await database.run('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [contactId, req.user.id]);

    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve message logs' });
  }
});

// Get message history in a project group team room
app.get('/api/messages/group/:groupId', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    // Verify membership
    const isMember = await database.get('SELECT 1 FROM group_members WHERE group_id = ? AND worker_id = ?', [groupId, req.user.id]);
    const isAdminOrClient = req.user.role === 'admin' || req.user.role === 'client';
    
    if (!isMember && !isAdminOrClient) {
      return res.status(403).json({ error: 'You are not authorized to view this group chat' });
    }

    const history = await database.query(`
      SELECT m.id, m.sender_id, m.message, m.created_at, u.name as sender_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.group_id = ?
      ORDER BY m.id ASC
    `, [groupId]);

    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve group messages' });
  }
});

// Send message to a project group team room
app.post('/api/messages/group/:groupId/send', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const { message } = req.body;
    const senderId = req.user.id;

    if (!message) return res.status(400).json({ error: 'Message content required' });

    // Verify membership
    const isMember = await database.get('SELECT 1 FROM group_members WHERE group_id = ? AND worker_id = ?', [groupId, senderId]);
    const isAdminOrClient = req.user.role === 'admin' || req.user.role === 'client';
    
    if (!isMember && !isAdminOrClient) {
      return res.status(403).json({ error: 'You are not a member of this project group' });
    }

    const result = await database.run(
      'INSERT INTO messages (sender_id, group_id, message) VALUES (?, ?, ?)',
      [senderId, groupId, message]
    );

    const messageObj = {
      id: result.id,
      sender_id: senderId,
      sender_name: req.user.name,
      sender_role: req.user.role,
      message,
      created_at: new Date().toISOString()
    };

    // Broadcast message to group sockets
    await broadcastGroupMessage(groupId, messageObj);

    res.json({ success: true, message: messageObj });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send group message' });
  }
});

// Get total unread messages count
app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
  try {
    const row = await database.get('SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0', [req.user.id]);
    res.json({ success: true, unreadCount: row.count || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to count unread messages' });
  }
});

// HTTP fallback to send message if websocket not connected
app.post('/api/messages/send', authenticateToken, async (req, res) => {
  try {
    const { receiver_id, message } = req.body;
    if (!receiver_id || !message) {
      return res.status(400).json({ error: 'Missing recipient or content' });
    }

    const result = await database.run(
      'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
      [req.user.id, receiver_id, message]
    );

    const messageObj = {
      id: result.id,
      sender_id: req.user.id,
      receiver_id: parseInt(receiver_id),
      message,
      created_at: new Date().toISOString(),
      is_read: 0
    };

    // Dispatch via WS if receiver connected
    broadcastMessage(messageObj);

    res.json({ success: true, message: messageObj });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ==========================================
// 7. WEBSOCKET CONTROLLER
// ==========================================

const clientsMap = new Map(); // Map of userId -> WebSocket connection

function broadcastMessage(messageObj) {
  const receiverSocket = clientsMap.get(messageObj.receiver_id);
  if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
    receiverSocket.send(JSON.stringify({ type: 'message', data: messageObj }));
  }
  
  const senderSocket = clientsMap.get(messageObj.sender_id);
  if (senderSocket && senderSocket.readyState === WebSocket.OPEN) {
    senderSocket.send(JSON.stringify({ type: 'message_sent', data: messageObj }));
  }
}

async function broadcastGroupMessage(groupId, messageObj) {
  try {
    const members = await database.query('SELECT worker_id FROM group_members WHERE group_id = ?', [groupId]);
    const group = await database.get('SELECT client_id FROM groups WHERE id = ?', [groupId]);
    
    const recipientIds = new Set(members.map(m => m.worker_id));
    if (group && group.client_id) recipientIds.add(group.client_id);
    recipientIds.add(1); // Admin user
    
    recipientIds.forEach(userId => {
      const socket = clientsMap.get(userId);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          type: 'group_message', 
          data: { ...messageObj, group_id: parseInt(groupId) } 
        }));
      }
    });
  } catch (err) {
    console.error('Group WS broadcast error:', err);
  }
}

wss.on('connection', (ws, req) => {
  let authenticatedUser = null;

  ws.on('message', async (messageText) => {
    try {
      const payload = JSON.parse(messageText);

      // 1. Authenticate connection
      if (payload.type === 'auth') {
        const token = payload.token;
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Auth failed' }));
            ws.close();
            return;
          }
          authenticatedUser = decoded;
          clientsMap.set(decoded.id, ws);
          ws.send(JSON.stringify({ type: 'authenticated', userId: decoded.id }));
        });
      }

      // 2. Chat message handling
      if (payload.type === 'send_chat') {
        if (!authenticatedUser) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthenticated' }));
          return;
        }

        const { receiver_id, message } = payload.data;
        
        // Save to DB
        const result = await database.run(
          'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
          [authenticatedUser.id, receiver_id, message]
        );

        const messageObj = {
          id: result.id,
          sender_id: authenticatedUser.id,
          receiver_id: parseInt(receiver_id),
          message,
          created_at: new Date().toISOString(),
          is_read: 0
        };

        broadcastMessage(messageObj);
      }

      // Group Chat message handling
      if (payload.type === 'send_group_chat') {
        if (!authenticatedUser) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthenticated' }));
          return;
        }

        const { group_id, message } = payload.data;
        
        const result = await database.run(
          'INSERT INTO messages (sender_id, group_id, message) VALUES (?, ?, ?)',
          [authenticatedUser.id, group_id, message]
        );

        const messageObj = {
          id: result.id,
          sender_id: authenticatedUser.id,
          sender_name: authenticatedUser.name,
          sender_role: authenticatedUser.role,
          message,
          created_at: new Date().toISOString()
        };

        await broadcastGroupMessage(group_id, messageObj);
      }
    } catch (err) {
      console.error('WS Message error:', err);
    }
  });

  ws.on('close', () => {
    if (authenticatedUser) {
      clientsMap.delete(authenticatedUser.id);
    }
  });
});

// Integrate WebSocket server with HTTP server
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// ==========================================
// GLOBAL ERROR HANDLER (Prevents info leakage)
// ==========================================
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Express error handler (catches all errors)
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err.message);
  
  // Don't send sensitive error details to client
  const isDevelopment = NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { details: err.stack })
  });
});

const isFirebase = !!(process.env.FIREBASE_CONFIG || process.env.FUNCTIONS_EMULATOR);

if (!isFirebase) {
  // Initialize database then start server
  database.initDb().then(() => {
    server.listen(PORT, () => {
      console.log(`\n✅ Server is running at http://localhost:${PORT}`);
      console.log(`🔒 Security enabled: Rate limiting, CORS, Helmet, Input validation`);
      console.log(`📦 Database: ${process.env.DATABASE_PATH || './database.db'}\n`);
    });
  }).catch(err => {
    console.error('Failed to initialize database:', err);
  });
} else {
  // Export as a Firebase Cloud Function
  const functions = require('firebase-functions');
  exports.api = functions.https.onRequest(async (req, res) => {
    await database.initDb();
    return app(req, res);
  });
}

