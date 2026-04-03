/**
 * Tool 14: report_tx_hash
 * エージェントがトランザクション実行後に結果を報告する
 *
 * 対象:
 * - payment_id → mcp_payments.tx_hash を更新
 * - order_id + type=escrow → mcp_orders.escrow_tx_hash を更新、status を escrowed に
 * - order_id + type=release → mcp_orders.release_tx_hash を更新、status を completed に
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ payment_id, order_id, type, tx_hash }) {
  if (!tx_hash) {
    throw new Error('tx_hash は必須です');
  }

  // tx_hashの形式チェック（0x + 64hex）
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
    throw new Error('tx_hash の形式が不正です（0x + 64桁の16進数）');
  }

  if (payment_id) {
    // タスク外注の送金報告
    const { data: payment, error } = await supabase
      .from('mcp_payments')
      .select('id, tx_hash')
      .eq('id', payment_id)
      .single();

    if (error || !payment) {
      throw new Error(`送金ID ${payment_id} が見つかりません`);
    }

    if (payment.tx_hash) {
      throw new Error(`この送金には既にtx_hashが登録されています: ${payment.tx_hash}`);
    }

    await supabase
      .from('mcp_payments')
      .update({ tx_hash })
      .eq('id', payment_id);

    return {
      type: 'payment',
      payment_id,
      tx_hash,
      message: 'トランザクションハッシュを記録しました',
    };
  }

  if (order_id) {
    const { data: order, error } = await supabase
      .from('mcp_orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (error || !order) {
      throw new Error(`注文ID ${order_id} が見つかりません`);
    }

    if (type === 'escrow') {
      // エスクロー送金完了の報告
      if (order.status !== 'pending') {
        throw new Error(`この注文は ${order.status} 状態です。エスクロー報告は pending の注文のみです`);
      }

      await supabase
        .from('mcp_orders')
        .update({
          escrow_tx_hash: tx_hash,
          status: 'escrowed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);

      return {
        type: 'escrow',
        order_id,
        tx_hash,
        status: 'escrowed',
        message: 'エスクロー送金を確認。商品の発送を待っています',
      };

    } else if (type === 'release') {
      // エスクロー解放完了の報告
      if (!['delivered', 'escrowed', 'shipped'].includes(order.status)) {
        throw new Error(`この注文は ${order.status} 状態です`);
      }

      await supabase
        .from('mcp_orders')
        .update({
          release_tx_hash: tx_hash,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);

      return {
        type: 'release',
        order_id,
        tx_hash,
        status: 'completed',
        message: 'エスクロー解放完了。取引が完了しました',
      };

    } else {
      throw new Error('type は "escrow" または "release" を指定してください');
    }
  }

  throw new Error('payment_id または order_id のいずれかを指定してください');
}
