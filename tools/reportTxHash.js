/**
 * Tool 14: report_tx_hash
 * エージェントがトランザクション実行後に結果を報告する
 */
import { db } from '../lib/db.js';

export default async function handler({ payment_id, order_id, type, tx_hash }) {
  if (!tx_hash) throw new Error('tx_hash は必須です');
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
    throw new Error('tx_hash の形式が不正です（0x + 64桁の16進数）');
  }

  if (payment_id) {
    const { rows } = await db.query(
      `SELECT id, tx_hash FROM mcp_payments WHERE id = $1`,
      [payment_id]
    );
    const payment = rows[0];
    if (!payment) throw new Error(`送金ID ${payment_id} が見つかりません`);
    if (payment.tx_hash) throw new Error(`この送金には既にtx_hashが登録されています: ${payment.tx_hash}`);

    await db.query(`UPDATE mcp_payments SET tx_hash = $1 WHERE id = $2`, [tx_hash, payment_id]);
    return { type: 'payment', payment_id, tx_hash, message: 'トランザクションハッシュを記録しました' };
  }

  if (order_id) {
    const { rows } = await db.query(`SELECT * FROM mcp_orders WHERE id = $1`, [order_id]);
    const order = rows[0];
    if (!order) throw new Error(`注文ID ${order_id} が見つかりません`);

    if (type === 'escrow') {
      if (order.status !== 'pending') {
        throw new Error(`この注文は ${order.status} 状態です。エスクロー報告は pending の注文のみです`);
      }
      await db.query(
        `UPDATE mcp_orders SET escrow_tx_hash = $1, status = 'escrowed', updated_at = NOW() WHERE id = $2`,
        [tx_hash, order_id]
      );
      return { type: 'escrow', order_id, tx_hash, status: 'escrowed', message: 'エスクロー送金を確認。商品の発送を待っています' };

    } else if (type === 'release') {
      if (!['delivered', 'escrowed', 'shipped'].includes(order.status)) {
        throw new Error(`この注文は ${order.status} 状態です`);
      }
      await db.query(
        `UPDATE mcp_orders SET release_tx_hash = $1, status = 'completed', updated_at = NOW() WHERE id = $2`,
        [tx_hash, order_id]
      );
      return { type: 'release', order_id, tx_hash, status: 'completed', message: 'エスクロー解放完了。取引が完了しました' };

    } else {
      throw new Error('type は "escrow" または "release" を指定してください');
    }
  }

  throw new Error('payment_id または order_id のいずれかを指定してください');
}
