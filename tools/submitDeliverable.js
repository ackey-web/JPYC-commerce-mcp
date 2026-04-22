/**
 * Tool: submit_deliverable — ノンカストディアル
 *
 * ワーカーが成果物ハッシュをオンチェーンに記録する（ASSIGNED → SUBMITTED）。
 * MCPはトランザクションを実行しない。calldata を返すのみ。
 */
import { db } from '../lib/db.js';
import { buildSubmitDeliverableInstruction } from '../lib/bountyCalldataBuilder.js';

export default async function handler({ bounty_id, worker_wallet, deliverable_hash }) {
  if (!bounty_id) throw new Error('bounty_id は必須です');
  if (!worker_wallet) throw new Error('worker_wallet は必須です');
  if (!deliverable_hash) throw new Error('deliverable_hash は必須です');

  const normalized = worker_wallet.toLowerCase();

  const { rows } = await db.query(`SELECT * FROM mcp_bounties WHERE id = $1`, [bounty_id]);
  const bounty = rows[0];
  if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つかりません`);

  // ASSIGNED 状態の確認（acceptBid 後に遷移）
  if (bounty.status !== 'assigned') {
    throw new Error(`バウンティは ${bounty.status} 状態です。submitDeliverable できるのは assigned 状態のみです`);
  }
  if (!bounty.job_key) throw new Error('job_key が未設定です（openBounty が完了していない可能性があります）');

  // 落札したワーカーのみ提出可能
  const { rows: bidRows } = await db.query(
    `SELECT * FROM mcp_bounty_bids WHERE bounty_id = $1 AND status = 'accepted'`,
    [bounty_id]
  );
  const acceptedBid = bidRows[0];
  if (!acceptedBid) throw new Error('落札者が見つかりません');
  if (acceptedBid.bidder_wallet !== normalized) {
    throw new Error('このバウンティの落札者のみが成果物を提出できます');
  }

  // DBを楽観的更新（オンチェーン確定前）
  await db.query(
    `UPDATE mcp_bounties SET status = 'submitted', updated_at = NOW() WHERE id = $1`,
    [bounty_id]
  );
  await db.query(
    `UPDATE mcp_bounty_bids SET deliverable_hash = $1 WHERE id = $2`,
    [deliverable_hash, acceptedBid.id]
  );

  const txInstruction = buildSubmitDeliverableInstruction(bounty.job_key, deliverable_hash);

  return {
    bounty_id,
    job_key: bounty.job_key,
    worker_wallet: normalized,
    deliverable_hash,
    status: 'submitted',
    tx_instruction: txInstruction,
    next_step: 'tx_instruction のトランザクションをウォレットで署名・送信してください。クライアントが confirm_delivery を呼ぶまで JPYC はエスクロー保留です',
  };
}
