/**
 * shared/audit.js
 * ─────────────────────────────────────────────────────────────
 * Immutable append-only audit logger.
 * Every row gets a SHA-256 checksum of its content so tampering
 * can be detected later. Rows are never updated or deleted.
 * ─────────────────────────────────────────────────────────────
 */

'use strict';
const crypto = require('crypto');
const database = require('../database/database');

/**
 * Compute a tamper-detection checksum for an audit row.
 */
function computeChecksum({ userId, userEmail, role, action, details, ipAddress, timestamp }) {
  const payload = JSON.stringify({ userId, userEmail, role, action, details, ipAddress, timestamp });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Log a security or admin event to the immutable audit log.
 *
 * @param {object} opts
 * @param {string} opts.action      - Event name e.g. 'admin_login', 'password_reset'
 * @param {number} [opts.userId]    - ID of the acting user (0 for anonymous)
 * @param {string} [opts.userEmail] - Email of the acting user
 * @param {string} [opts.role]      - Role of the acting user
 * @param {string} [opts.details]   - JSON-serialisable detail string
 * @param {string} [opts.ipAddress] - Request IP address
 * @param {string} [opts.severity]  - 'low' | 'medium' | 'high' | 'critical'
 */
async function logAuditEvent({ action, userId = 0, userEmail = 'anonymous', role = 'unknown', details = '', ipAddress = 'unknown', severity = 'medium' }) {
  try {
    const timestamp = new Date().toISOString();
    const checksum = computeChecksum({ userId, userEmail, role, action, details, ipAddress, timestamp });

    await database.run(
      `INSERT INTO admin_audit_logs
        (admin_id, admin_email, role, action, details, ip_address, user_agent, timestamp, checksum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, userEmail, role, action, details, ipAddress, severity, timestamp, checksum]
    );
  } catch (err) {
    // Audit logging must NEVER crash the main application
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

/**
 * Log a security event (failed logins, suspicious activity, IP blocks).
 */
async function logSecurityEvent({ eventType, ipAddress = 'unknown', details = '', severity = 'medium' }) {
  try {
    await database.run(
      `INSERT INTO security_events (event_type, ip_address, details, severity)
       VALUES (?, ?, ?, ?)`,
      [eventType, ipAddress, details, severity]
    );
  } catch (err) {
    console.error('[audit] Failed to write security event:', err.message);
  }
}

/**
 * Verify the integrity of audit logs — detect any tampered rows.
 * Returns an array of tampered row IDs (empty if all clean).
 */
async function verifyAuditIntegrity() {
  const rows = await database.query(
    `SELECT id, admin_id, admin_email, role, action, details, ip_address, user_agent, timestamp, checksum
     FROM admin_audit_logs WHERE checksum IS NOT NULL`
  );
  const tampered = [];
  for (const row of rows) {
    const expected = computeChecksum({
      userId: row.admin_id,
      userEmail: row.admin_email,
      role: row.role,
      action: row.action,
      details: row.details,
      ipAddress: row.ip_address,
      timestamp: row.timestamp
    });
    if (expected !== row.checksum) {
      tampered.push(row.id);
    }
  }
  return tampered;
}

module.exports = { logAuditEvent, logSecurityEvent, verifyAuditIntegrity };
