/**
 * shared/crypto.js
 * ─────────────────────────────────────────────────────────────
 * AES-256-GCM field-level encryption for sensitive database
 * columns (phone numbers, payment metadata, private keys).
 *
 * Key loaded from FIELD_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 * Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * ─────────────────────────────────────────────────────────────
 */

'use strict';
require('dotenv').config();
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;      // 96 bits — GCM standard
const TAG_LENGTH = 16;     // 128-bit auth tag

// Load encryption key from environment
function getKey() {
  const hexKey = process.env.FIELD_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be set in .env as a 64-char hex string (32 bytes). ' +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a compact string: base64(iv):base64(tag):base64(ciphertext)
 * Returns null if plaintext is null/undefined.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

/**
 * Decrypt an encrypted string produced by encrypt().
 * Returns null if input is null/undefined/not encrypted format.
 */
function decrypt(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) return null;
  // If not encrypted format, return as-is (for gradual migration)
  if (!ciphertext.includes(':')) return ciphertext;

  const [ivB64, tagB64, encB64] = ciphertext.split(':');
  if (!ivB64 || !tagB64 || !encB64) return ciphertext;

  try {
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch (err) {
    // Auth tag mismatch = data tampered — return null, log upstream
    console.error('[crypto] Decryption failed — possible data tampering:', err.message);
    return null;
  }
}

/**
 * Hash a token (reset token, etc.) with SHA-256 for safe DB storage.
 * The raw token is sent to the user; only the hash is stored.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure random token string.
 * @param {number} bytes - Number of random bytes (default 32)
 * @returns {string} hex string
 */
function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { encrypt, decrypt, hashToken, generateSecureToken };
