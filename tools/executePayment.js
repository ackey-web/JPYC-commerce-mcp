/**
 * Tool 5 (v3): execute_payment — ノンカストディアル
 *
 * MCPサーバーはトランザクションを実行しない。
 * 「このコントラクトのこの関数をこの引数で呼べ」という指示を返すだけ。
 * エージェントが自分の秘密鍵で署名・送信する。
 */
import { db } from '../lib/db.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';

export default async function handler({ negotiation_id, from_wallet, to_wallet }) {
  const { rows: negRows } = await db.query(
    `SELECT * FROM mcp_negotiations WHERE id = $1`,
    [negotiation_id]
  );
  const negotiation = negRows[0];
  if (!negotiation) throw new Error(`交渉ID ${negotiation_id} が見つかりません`);
  if (negotiation.status !== 'approved') throw new Error('この交渉はまだ承認されていません');

  const amount = negotiation.proposed_amount;
  const txInstruction = buildTransferFromInstruction(from_wallet, to_wallet, amount);

  const { rows } = await db.query(
    `INSERT INTO mcp_payments (negotiation_id, from_wallet, to_wallet, amount, tx_hash)
     VALUES ($1, $2, $3, $4, NULL)
     RETURNING id`,
    [negotiation_id, from_wallet, to_wallet, amount]
  );

  return {
    payment_id: rows[0].id,
    amount,
    instruction: txInstruction,
    next_step: 'エージェントが自身の秘密鍵でこのトランザクションに署名・送信し、report_tx_hash で結果を報告してください',
  };
}
