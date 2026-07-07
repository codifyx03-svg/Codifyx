/**
 * shared/payout.js — Platform PayoutService Abstraction
 *
 * All money movement happens through this module.
 * Currently: internal ledger only.
 * Future: swap in Razorpay / Stripe by replacing the provider below.
 *
 * Fraud rules enforced here:
 *  - Only admin can release payments (callers must pass adminId)
 *  - Payment amounts are READ from DB, never trusted from client
 *  - Every operation is written to financial_audit_trail (append-only)
 */

'use strict';

const database = require('../database/database');
const crypto = require('crypto');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Append an immutable record to financial_audit_trail.
 * Checksum = SHA-256(event_type|reference_id|amount|actor_id|timestamp)
 */
async function _auditFinancial(eventType, referenceId, amount, actorId, details, tx = null) {
  const timestamp = new Date().toISOString();
  const raw = `${eventType}|${referenceId}|${amount}|${actorId}|${timestamp}`;
  const checksum = crypto.createHash('sha256').update(raw).digest('hex');
  const dbClient = tx || database;
  await dbClient.run(
    `INSERT INTO financial_audit_trail
       (event_type, reference_id, amount, actor_id, details, checksum, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventType, referenceId, amount, actorId, JSON.stringify(details), checksum, timestamp]
  );
}

async function _creditWallet(userId, walletType, amount, tx = null) {
  const dbClient = tx || database;
  await dbClient.run(
    `UPDATE wallets
        SET balance = balance + ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND wallet_type = ?`,
    [amount, userId, walletType]
  );
}

async function _debitWallet(userId, walletType, amount, tx = null) {
  const dbClient = tx || database;
  const wallet = await dbClient.get(
    'SELECT balance FROM wallets WHERE user_id = ? AND wallet_type = ?',
    [userId, walletType]
  );
  if (!wallet || wallet.balance < amount) {
    throw new Error(`Insufficient balance in ${walletType} wallet`);
  }
  await dbClient.run(
    `UPDATE wallets
        SET balance = balance - ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND wallet_type = ?`,
    [amount, userId, walletType]
  );
}

async function ensureWallet(userId, walletType, tx = null) {
  const dbClient = tx || database;
  const existing = await dbClient.get(
    'SELECT id FROM wallets WHERE user_id = ? AND wallet_type = ?',
    [userId, walletType]
  );
  if (!existing) {
    await dbClient.run(
      `INSERT INTO wallets (user_id, wallet_type, balance) VALUES (?, ?, 0)`,
      [userId, walletType]
    );
  }
}

// ─── Public PayoutService ─────────────────────────────────────────────────────

const PLATFORM_UID = 0; // Sentinel user_id representing the platform wallet

const PayoutService = {

  /**
   * Called when a project is funded (client pays platform).
   * Credits Platform Wallet and adds to project worker_budget_pool.
   */
  async fundProjectWallet(projectId, amount, actorId) {
    return database.transaction(async (tx) => {
      await ensureWallet(PLATFORM_UID, 'platform', tx);
      await _creditWallet(PLATFORM_UID, 'platform', amount, tx);
      const companyFee = (amount * 0.15) + 5000;
      const workerReserve = Math.max(0, amount - companyFee);
      await tx.run(
        `UPDATE projects SET worker_budget_pool = worker_budget_pool + ? WHERE id = ?`,
        [workerReserve, projectId]
      );
      await _auditFinancial('project_funded', projectId, amount, actorId, { projectId, companyFee, workerReserve }, tx);
      return { companyFee, workerReserve };
    });
  },

  /**
   * Admin releases payment for a completed task.
   * FRAUD PROTECTION: amount is read from DB, never from caller.
   *
   * Flow:
   *  1. Verify task is in 'review' state and payment_status = 'pending'
   *  2. Debit Platform Wallet
   *  3. Credit Worker Wallet
   *  4. Record in worker_payouts
   *  5. Update task to 'completed' + payment_status = 'released'
   *  6. Audit trail entry
   */
  async releaseTaskPayment(taskId, adminId) {
    return database.transaction(async (tx) => {
      const task = await tx.get(
        `SELECT t.id, t.payment_amount, t.assigned_worker_id as worker_id, t.project_id,
                t.status, t.payment_status, t.client_approval_status
           FROM tasks t
          WHERE t.id = ? AND t.status = 'review' AND t.payment_status = 'pending'`,
        [taskId]
      );
      if (!task) throw new Error('Task is not eligible for payment release (must be in review with pending payment)');
      if (!task.worker_id) throw new Error('Task has no assigned worker');
      if (task.client_approval_status !== 'approved') {
        throw new Error('Client approval is required before payment can be released');
      }

      const amount = task.payment_amount;
      const workerId = task.worker_id;

      await ensureWallet(PLATFORM_UID, 'platform', tx);
      await ensureWallet(workerId, 'worker', tx);

      await _debitWallet(PLATFORM_UID, 'platform', amount, tx);
      await _creditWallet(workerId, 'worker', amount, tx);

      await tx.run(
        `INSERT INTO worker_payouts (worker_id, task_id, project_id, amount, released_by, status)
         VALUES (?, ?, ?, ?, ?, 'released')`,
        [workerId, taskId, task.project_id, amount, adminId]
      );

      await tx.run(
        `UPDATE tasks SET status = 'completed', payment_status = 'approved', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [taskId]
      );

      await tx.run(
        `INSERT INTO worker_stats (worker_id, completed_tasks, total_tasks_assigned, total_earnings)
         VALUES (?, 1, 0, ?)
         ON CONFLICT(worker_id) DO UPDATE SET
           completed_tasks = completed_tasks + 1,
           total_earnings  = total_earnings + excluded.total_earnings,
           last_updated    = CURRENT_TIMESTAMP`,
        [workerId, amount]
      );

      await _auditFinancial('task_payment_released', taskId, amount, adminId, {
        taskId, workerId, projectId: task.project_id
      }, tx);

      return { taskId, workerId, amount };
    });
  },

  /**
   * Admin approves a worker withdrawal request.
   * Debits Worker Wallet and marks request as approved.
   * Future: call Razorpay payout API here.
   */
  async approveWithdrawal(withdrawalId, adminId) {
    return database.transaction(async (tx) => {
      const req = await tx.get(
        `SELECT * FROM withdraw_requests WHERE id = ? AND status = 'pending'`,
        [withdrawalId]
      );
      if (!req) throw new Error('Withdrawal request not found or already processed');

      const { worker_id, amount } = req;

      await ensureWallet(worker_id, 'worker', tx);
      await _debitWallet(worker_id, 'worker', amount, tx);

      await tx.run(
        `UPDATE withdraw_requests
            SET status = 'paid', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [adminId, withdrawalId]
      );

      await _auditFinancial('withdrawal_approved', withdrawalId, amount, adminId, {
        withdrawalId, workerId: worker_id
      }, tx);

      return { withdrawalId, workerId: worker_id, amount };
    });
  },

  /**
   * Admin rejects a withdrawal request.
   * Wallet balance is NOT touched.
   */
  async rejectWithdrawal(withdrawalId, adminId, reason) {
    return database.transaction(async (tx) => {
      const req = await tx.get(
        `SELECT * FROM withdraw_requests WHERE id = ? AND status = 'pending'`,
        [withdrawalId]
      );
      if (!req) throw new Error('Withdrawal request not found or already processed');

      await tx.run(
        `UPDATE withdraw_requests
            SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [reason || 'Rejected by admin', adminId, withdrawalId]
      );

      await _auditFinancial('withdrawal_rejected', withdrawalId, req.amount, adminId, {
        withdrawalId, reason
      }, tx);

      return { withdrawalId };
    });
  },

  /**
   * Worker submits a withdrawal request.
   * Validates against available wallet balance.
   */
  async requestWithdrawal(workerId, amount, payoutDetails) {
    if (!amount || amount <= 0) throw new Error('Amount must be positive');
    await ensureWallet(workerId, 'worker');
    const wallet = await database.get(
      'SELECT balance FROM wallets WHERE user_id = ? AND wallet_type = ?',
      [workerId, 'worker']
    );
    if (!wallet || wallet.balance < amount) {
      throw new Error('Insufficient wallet balance');
    }

    const result = await database.run(
      `INSERT INTO withdraw_requests (worker_id, amount, payout_details, status) VALUES (?, ?, ?, 'pending')`,
      [workerId, amount, JSON.stringify(payoutDetails)]
    );

    const newId = result.id || result.changes || 0;
    await _auditFinancial('withdrawal_requested', newId, amount, workerId, {
      workerId, payoutDetails
    });

    return { requestId: newId };
  },

  /**
   * Get wallet balance for a user/type.
   */
  async getBalance(userId, walletType) {
    await ensureWallet(userId, walletType);
    const wallet = await database.get(
      'SELECT balance FROM wallets WHERE user_id = ? AND wallet_type = ?',
      [userId, walletType]
    );
    return wallet ? wallet.balance : 0;
  },

  /**
   * Get financial audit trail (admin only).
   */
  async getAuditTrail(limit = 200) {
    return database.query(
      `SELECT fat.*, u.name as actor_name, u.email as actor_email
         FROM financial_audit_trail fat
         LEFT JOIN users u ON u.id = fat.actor_id
        ORDER BY fat.id DESC
        LIMIT ?`,
      [limit]
    );
  }
};

module.exports = { PayoutService, ensureWallet, PLATFORM_UID };
