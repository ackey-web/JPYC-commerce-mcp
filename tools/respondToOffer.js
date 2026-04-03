/**
 * Tool 9: respond_to_offer
 * 受注側エージェントが発注側の交渉提案に対して応答する
 *
 * 応答タイプ:
 * - accepted: 提案額を受諾 → 承認フローへ進む
 * - rejected: 提案を拒否 → 交渉終了
 * - countered: カウンターオファーを提示 → 新しい交渉ラウンドへ
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ negotiation_id, response, counter_amount, message }) {
  // 交渉データ取得
  const { data: negotiation, error } = await supabase
    .from('mcp_negotiations')
    .select('*')
    .eq('id', negotiation_id)
    .single();

  if (error || !negotiation) {
    throw new Error(`交渉ID ${negotiation_id} が見つかりません`);
  }

  if (negotiation.status !== 'pending') {
    throw new Error(`この交渉は既に ${negotiation.status} 状態です。応答できるのは pending の交渉のみです`);
  }

  if (negotiation.agent_response && negotiation.agent_response !== 'pending') {
    throw new Error(`この交渉には既に応答済みです (${negotiation.agent_response})`);
  }

  // タスク取得（レンジ確認用）
  const { data: task } = await supabase
    .from('mcp_tasks')
    .select('recommended_reward_min, recommended_reward_max')
    .eq('id', negotiation.task_id)
    .single();

  const result = {
    negotiation_id,
    response,
    previous_amount: negotiation.proposed_amount,
  };

  if (response === 'accepted') {
    // 受諾 → 交渉ステータスを approved に（承認フローへ）
    await supabase
      .from('mcp_negotiations')
      .update({
        agent_response: 'accepted',
        agent_message: message || null,
        status: 'approved',
      })
      .eq('id', negotiation_id);

    // タスクも approved に
    await supabase
      .from('mcp_tasks')
      .update({ status: 'approved' })
      .eq('id', negotiation.task_id);

    result.final_amount = negotiation.proposed_amount;
    result.next_step = 'execute_payment';
    result.message = `${negotiation.proposed_amount} JPYC で合意。execute_payment で送金を実行してください`;

  } else if (response === 'rejected') {
    // 拒否 → 交渉終了
    await supabase
      .from('mcp_negotiations')
      .update({
        agent_response: 'rejected',
        agent_message: message || null,
        status: 'rejected',
      })
      .eq('id', negotiation_id);

    // 入札も rejected に
    if (negotiation.bid_id) {
      await supabase
        .from('mcp_bids')
        .update({ status: 'rejected' })
        .eq('id', negotiation.bid_id);
    }

    // タスクを pending に戻す（他のエージェントが入札できるように）
    await supabase
      .from('mcp_tasks')
      .update({ status: 'pending' })
      .eq('id', negotiation.task_id);

    result.message = '交渉を拒否しました。タスクは再度入札可能な状態に戻りました';
    result.next_step = 'submit_bid (new agent) or propose_negotiation (revised offer)';

  } else if (response === 'countered') {
    // カウンターオファー
    if (!counter_amount || counter_amount <= 0) {
      throw new Error('countered の場合は counter_amount（希望額）が必要です');
    }

    // カウンター額の妥当性チェック（警告のみ）
    let warning = null;
    if (task) {
      if (counter_amount > task.recommended_reward_max * 1.5) {
        warning = `カウンター額 ${counter_amount} JPYC は推奨上限の1.5倍を超えています`;
      }
    }

    await supabase
      .from('mcp_negotiations')
      .update({
        agent_response: 'countered',
        agent_counter_amount: counter_amount,
        agent_message: message || null,
      })
      .eq('id', negotiation_id);

    result.counter_amount = counter_amount;
    result.warning = warning;
    result.message = `${counter_amount} JPYC でカウンターオファーを提示しました。発注側は propose_negotiation で再提案するか、この額で合意できます`;
    result.next_step = 'propose_negotiation (round 2) or request_human_approval (accept counter)';

  } else {
    throw new Error(`無効な応答: ${response}。accepted / rejected / countered のいずれかを指定してください`);
  }

  return result;
}
