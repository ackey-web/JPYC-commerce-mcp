/**
 * Tool: cancel_bounty — ノンカストディアル
 *
 * クライアント（poster）がOPEN状態のバウンティをキャンセルし、JPYCをエスクローから回収する。
 * ASSIGNED以降はキャンセル不可（ワーカー保護）。
 * MCPはトランザクションを実行しない。calldata を返すのみ。
 */
import { db } from '../lib/db.js';
import { buildCancelBountyInstruction } from '../lib/bountyCalldataBuilder.js';

export default async function handler({ bounty_id, client_wallet }) {
  if (!bounty_id) throw new Error('bounty_id は必須です');
  if (!client_wallet) throw new Error('client_wallet は必須です');

  const normalized = client_wallet.toLowerCase();

  const { rows } = await db.query(`SELECT * FROM mcp_bounties WHERE id = $1`, [bounty_id]);
  const bounty = rows[0];
  if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つかりません`);

  if (bounty.client_wallet !== normalized) {
    throw new Error('このバウンティのクライアント（poster）のみが cancelBounty を呼べます');
  }

  // OPEN 状態のみキャンセル可能（ASSIGNED 以降はワーカー保護のため不可）
  if (bounty.status !== 'open') {
    throw new Error(`バウンティは ${bounty.status} 状態です。cancelBounty できるのは open 状態のみです`);
  }
  if (!bounty.job_key) throw new Error('job_key が未設定です（openBounty が完了していない可能性があります）');

  // DBを楽観的更新
  await db.query(
    `UPDATE mcp_bounties SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [bounty_id]
  );
  // 未解決の入札はすべてキャンセル
  await db.query(
    `UPDATE mcp_bounty_bids SET status = 'rejected' WHERE bounty_id = $1 AND status = 'pending'`,
    [bounty_id]
  );

  const txInstruction = buildCancelBountyInstruction(bounty.job_key);

  return {
    bounty_id,
    job_key: bounty.job_key,
    client_wallet: normalized,
    amount: bounty.amount,
    status: 'cancelled',
    tx_instruction: txInstruction,
    next_step: 'tx_instruction のトランザクションをウォレットで署名・送信してください。成功後、エスクローの JPYC がクライアントに返還されます',
  };
}
