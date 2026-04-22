/**
 * Tool: open_bounty
 * evaluateTask で査定済みのタスクに JPYC バウンティを設定する。
 * BountyEscrow.openBountyFromAllowance の calldata を返す（ノンカストディアル）。
 *
 * 事前条件:
 *   1. クライアントが JPYC.approve(BOUNTY_ESCROW_ADDRESS, amount) を実行済み
 *   2. amount が task の recommended_reward_min 以上
 */
import { db } from '../lib/db.js';
import { buildOpenBountyInstruction } from '../lib/bountyCalldataBuilder.js';
import { buildApproveInstruction } from '../lib/txBuilder.js';
import { randomBytes } from 'crypto';

const BOUNTY_ESCROW_ADDRESS = process.env.BOUNTY_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000';
const DEFAULT_EXPIRY_DAYS = parseInt(process.env.BOUNTY_EXPIRY_DAYS || '30', 10);

export default async function handler({ task_id, client_wallet, amount, expiry_days }) {
  const normalized = client_wallet.toLowerCase();

  const { rows: taskRows } = await db.query(
    `SELECT * FROM mcp_tasks WHERE id = $1`,
    [task_id]
  );
  const task = taskRows[0];
  if (!task) throw new Error(`タスクID ${task_id} が見つかりません`);
  if (task.status !== 'pending') throw new Error(`タスクは既に ${task.status} 状態です`);

  if (amount < task.recommended_reward_min) {
    throw new Error(
      `バウンティ額 ${amount} JPYC は推奨最低額 ${task.recommended_reward_min} JPYC を下回っています`
    );
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM mcp_bounties WHERE task_id = $1 AND status NOT IN ('cancelled')`,
    [task_id]
  );
  if (existing[0]) throw new Error(`タスク ${task_id} には既にアクティブなバウンティが存在します`);

  // jobKey: クライアント指定の一意キー（bytes32）
  const jobKeyBytes = randomBytes(32);
  const jobKey = '0x' + jobKeyBytes.toString('hex');

  const expiryDays = expiry_days || DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

  const { rows: bountyRows } = await db.query(
    `INSERT INTO mcp_bounties (task_id, client_wallet, amount, job_key, status, expires_at)
     VALUES ($1, $2, $3, $4, 'pending_open', $5)
     RETURNING id`,
    [task_id, normalized, amount, jobKey, expiresAt.toISOString()]
  );
  const bountyId = bountyRows[0].id;

  const approveInstruction = buildApproveInstruction(BOUNTY_ESCROW_ADDRESS, amount);
  const openBountyInstruction = buildOpenBountyInstruction(jobKey, amount);

  return {
    bounty_id: bountyId,
    task_id,
    client_wallet: normalized,
    amount,
    job_key: jobKey,
    status: 'pending_open',
    expires_at: expiresAt.toISOString(),
    instructions: [
      {
        step: 1,
        action: 'approve',
        description: `BountyEscrowコントラクトへの JPYC approve（${amount} JPYC）`,
        tx_instruction: approveInstruction,
      },
      {
        step: 2,
        action: 'open_bounty',
        description: 'BountyEscrow.openBounty を呼び出しバウンティを開く（approve 完了後）',
        tx_instruction: openBountyInstruction,
      },
    ],
    next_step: 'step 1 の approve → step 2 の openBounty を順番に実行後、report_tx_hash でハッシュを報告してください',
  };
}

