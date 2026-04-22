/**
 * Tool: claim_expired — ノンカストディアル
 *
 * バウンティが期限切れの場合にクライアントが資金を回収する（OPEN → EXPIRED）。
 * expires_at を過ぎた OPEN バウンティのみ対象。
 * MCPはトランザクションを実行しない。calldata を返すのみ。
 */
import { db } from '../lib/db.js';
import { buildClaimExpiredInstruction } from '../lib/bountyCalldataBuilder.js';

export default async function handler({ bounty_id, client_wallet }) {
  if (!bounty_id) throw new Error('bounty_id は必須です');
  if (!client_wallet) throw new Error('client_wallet は必須です');

  const normalized = client_wallet.toLowerCase();

  const { rows } = await db.query(`SELECT * FROM mcp_bounties WHERE id = $1`, [bounty_id]);
  const bounty = rows[0];
  if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つかりません`);

  if (bounty.client_wallet !== normalized) {
    throw new Error('このバウンティのクライアントのみが claimExpired を呼べます');
  }

  // 期限切れ確認（open 状態かつ expires_at が現在時刻以前）
  if (bounty.status !== 'open') {
    throw new Error(`バウンティは ${bounty.status} 状態です。claimExpired できるのは open 状態のみです`);
  }
  if (!bounty.job_key) throw new Error('job_key が未設定です');

  if (bounty.expires_at) {
    const now = new Date();
    const expiresAt = new Date(bounty.expires_at);
    if (now < expiresAt) {
      throw new Error(`バウンティはまだ期限切れではありません（期限: ${expiresAt.toISOString()}）`);
    }
  }

  // DBを楽観的更新
  await db.query(
    `UPDATE mcp_bounties SET status = 'expired', updated_at = NOW() WHERE id = $1`,
    [bounty_id]
  );
  // 未解決の入札はすべてキャンセル
  await db.query(
    `UPDATE mcp_bounty_bids SET status = 'rejected' WHERE bounty_id = $1 AND status = 'pending'`,
    [bounty_id]
  );

  const txInstruction = buildClaimExpiredInstruction(bounty.job_key);

  return {
    bounty_id,
    job_key: bounty.job_key,
    client_wallet: normalized,
    amount: bounty.amount,
    status: 'expired',
    tx_instruction: txInstruction,
    next_step: 'tx_instruction のトランザクションをウォレットで署名・送信してください。成功後、エスクローの JPYC がクライアントに返還されます',
  };
}
