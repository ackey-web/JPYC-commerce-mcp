/**
 * Tool 3 (v2): propose_negotiation
 * trust_scoreベースで交渉条件を生成する
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ task_id, agent_wallet }) {
  // タスクを取得
  const { data: task, error: taskError } = await supabase
    .from('mcp_tasks')
    .select('difficulty_score, recommended_reward_min, recommended_reward_max')
    .eq('id', task_id)
    .single();

  if (taskError || !task) {
    throw new Error(`タスクID ${task_id} が見つかりません`);
  }

  // エージェントプロファイルを取得
  const normalized = agent_wallet.toLowerCase();
  const { data: agent } = await supabase
    .from('mcp_agents')
    .select('id, trust_score')
    .eq('wallet_address', normalized)
    .maybeSingle();

  const trustScore = agent?.trust_score ?? 0;

  const { recommended_reward_min, recommended_reward_max, difficulty_score } = task;

  // v2算出式: scoreFactor = min(trust_score / 100, 1.0)
  const scoreFactor = Math.min(trustScore / 100, 1.0);
  const proposed_amount = Math.round(
    recommended_reward_min +
    (recommended_reward_max - recommended_reward_min) * scoreFactor
  );

  // 根拠の説明文
  const rationale =
    `信頼スコア: ${trustScore}（scoreFactor: ${Math.round(scoreFactor * 100) / 100}）、` +
    `タスク難易度: ${difficulty_score}、` +
    `報酬レンジ: ${recommended_reward_min}〜${recommended_reward_max} JPYC に基づき、` +
    `${proposed_amount} JPYCを提案します。`;

  // mcp_negotiations に INSERT
  const { data: negotiation, error: negError } = await supabase
    .from('mcp_negotiations')
    .insert({
      task_id,
      agent_wallet: normalized,
      proposed_amount,
      rationale,
      status: 'pending',
    })
    .select('id')
    .single();

  if (negError) {
    throw new Error(`交渉レコード保存失敗: ${negError.message}`);
  }

  // タスクステータスを 'negotiating' に更新
  await supabase
    .from('mcp_tasks')
    .update({ status: 'negotiating' })
    .eq('id', task_id);

  return {
    negotiation_id: negotiation.id,
    proposed_amount,
    rationale,
  };
}
