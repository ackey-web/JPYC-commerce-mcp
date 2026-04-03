/**
 * Tool 8: submit_bid
 * 受注側エージェントがタスクに対して見積もり（入札）を提示する
 *
 * フロー:
 * 1. タスクの存在と推奨報酬レンジを確認
 * 2. 入札額がレンジ内か検証（レンジ外でも許容するが警告を返す）
 * 3. エージェントプロファイルを取得（未登録なら自動作成）
 * 4. mcp_bidsに記録
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ task_id, agent_wallet, bid_amount, message }) {
  const normalized = agent_wallet.toLowerCase();

  // タスク取得
  const { data: task, error: taskError } = await supabase
    .from('mcp_tasks')
    .select('*')
    .eq('id', task_id)
    .single();

  if (taskError || !task) {
    throw new Error(`タスクID ${task_id} が見つかりません`);
  }

  if (task.status !== 'pending') {
    throw new Error(`このタスクは既に ${task.status} 状態です。入札できるのは pending のタスクのみです`);
  }

  // エージェント確認（なければ自動作成）
  let { data: agent } = await supabase
    .from('mcp_agents')
    .select('id, trust_score')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!agent) {
    const { data: newAgent } = await supabase
      .from('mcp_agents')
      .insert({ wallet_address: normalized })
      .select('id, trust_score')
      .single();
    agent = newAgent;
  }

  // 入札額のレンジチェック（警告のみ、拒否はしない）
  let warning = null;
  if (bid_amount < task.recommended_reward_min) {
    warning = `入札額 ${bid_amount} JPYC は推奨最低額 ${task.recommended_reward_min} JPYC を下回っています`;
  } else if (bid_amount > task.recommended_reward_max) {
    warning = `入札額 ${bid_amount} JPYC は推奨上限額 ${task.recommended_reward_max} JPYC を超えています`;
  }

  // 同一エージェントの重複入札チェック
  const { data: existingBid } = await supabase
    .from('mcp_bids')
    .select('id')
    .eq('task_id', task_id)
    .eq('agent_wallet', normalized)
    .eq('status', 'pending')
    .maybeSingle();

  if (existingBid) {
    throw new Error('このタスクに対して既にpendingの入札があります。先に前の入札が処理されてからお試しください');
  }

  // 入札記録
  const { data: bid, error: bidError } = await supabase
    .from('mcp_bids')
    .insert({
      task_id,
      agent_wallet: normalized,
      bid_amount,
      message: message || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (bidError) {
    throw new Error(`入札記録失敗: ${bidError.message}`);
  }

  return {
    bid_id: bid.id,
    task_id,
    agent_wallet: normalized,
    bid_amount,
    trust_score: agent.trust_score,
    recommended_range: {
      min: task.recommended_reward_min,
      max: task.recommended_reward_max,
    },
    warning,
    message: `${bid_amount} JPYC で入札しました（trust_score: ${agent.trust_score}）`,
  };
}
