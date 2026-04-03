/**
 * Tool 5 (v3): execute_payment — ノンカストディアル
 *
 * MCPサーバーはトランザクションを実行しない。
 * 「このコントラクトのこの関数をこの引数で呼べ」という指示を返すだけ。
 * エージェントが自分の秘密鍵で署名・送信する。
 *
 * 返却後にエージェントが report_tx_hash で結果を報告する想定。
 */
import { supabase } from '../lib/supabase.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';

export default async function handler({ negotiation_id, from_wallet, to_wallet }) {
  // 交渉データを取得
  const { data: negotiation, error } = await supabase
    .from('mcp_negotiations')
    .select('*')
    .eq('id', negotiation_id)
    .single();

  if (error || !negotiation) {
    throw new Error(`交渉ID ${negotiation_id} が見つかりません`);
  }

  if (negotiation.status !== 'approved') {
    throw new Error('この交渉はまだ承認されていません');
  }

  const amount = negotiation.proposed_amount;

  // トランザクション指示を生成（署名はエージェント側）
  const txInstruction = buildTransferFromInstruction(from_wallet, to_wallet, amount);

  // mcp_payments に pending 状態で記録（tx_hash はエージェントが報告後に更新）
  const { data: payment, error: insertError } = await supabase
    .from('mcp_payments')
    .insert({
      negotiation_id,
      from_wallet,
      to_wallet,
      amount,
      tx_hash: null, // エージェントが実行後に report_tx_hash で報告
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(`送金記録の保存に失敗: ${insertError.message}`);
  }

  return {
    payment_id: payment.id,
    amount,
    instruction: txInstruction,
    next_step: 'エージェントが自身の秘密鍵でこのトランザクションに署名・送信し、report_tx_hash で結果を報告してください',
  };
}
