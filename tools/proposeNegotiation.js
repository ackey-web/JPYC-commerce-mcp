/**
 * Tool 3 (v3): propose_negotiation
 * trust_score + 受注側の入札額を考慮して交渉条件を生成する
 *
 * bid_id が指定された場合:
 *   受注側の希望額とtrust_scoreを掛け合わせて提案額を算出
 *   - 高trust → 希望額に近い額を提案
 *   - 低trust → 推奨レンジ下限寄りにカウンター
 *
 * bid_id なしの場合（従来互換）:
 *   trust_scoreのみで算出
 *
 * カウンターオファーへの再提案（round 2+）:
 *   前回の提案額と受注側のカウンター額の間で歩み寄る
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ task_id, agent_wallet, bid_id }) {
  // タスクを取得
  const { data: task, error: taskError } = await supabase
    .from('mcp_tasks')
    .select('difficulty_score, recommended_reward_min, recommended_reward_max')
    .eq('id', task_id)
    .single();

  if (taskError || !task) {
    throw new Error(`タスクID ${task_id} が見つかりません`);
  }

  const normalized = agent_wallet.toLowerCase();

  // エージェントプロファイルを取得
  const { data: agent } = await supabase
    .from('mcp_agents')
    .select('id, trust_score')
    .eq('wallet_address', normalized)
    .maybeSingle();

  const trustScore = agent?.trust_score ?? 0;
  const scoreFactor = Math.min(trustScore / 100, 1.0);
  const { recommended_reward_min, recommended_reward_max, difficulty_score } = task;

  // 入札データ取得（あれ��）
  let bid = null;
  if (bid_id) {
    const { data: bidData } = await supabase
      .from('mcp_bids')
      .select('*')
      .eq('id', bid_id)
      .single();
    bid = bidData;
  }

  // 前回の交渉があるか（カウンターオファーへの再提案）
  const { data: prevNegotiations } = await supabase
    .from('mcp_negotiations')
    .select('*')
    .eq('task_id', task_id)
    .eq('agent_wallet', normalized)
    .order('round', { ascending: false })
    .limit(1);

  const prevNeg = prevNegotiations?.[0];
  const round = prevNeg ? (prevNeg.round || 1) + 1 : 1;

  let proposed_amount;
  let rationale;

  if (prevNeg?.agent_response === 'countered' && prevNeg.agent_counter_amount) {
    // === カウンターオファーへの再提案（歩み寄り） ===
    const prevOffer = prevNeg.proposed_amount;
    const counterOffer = prevNeg.agent_counter_amount;

    // trust_scoreが高いほど受注側寄りに歩み寄る
    // scoreFactor=1.0 → 受注側の希望額の90%まで寄る
    // scoreFactor=0.0 → 前回提案からほぼ動かない
    const concessionRate = 0.3 + 0.6 * scoreFactor; // 0.3〜0.9
    proposed_amount = Math.round(
      prevOffer + (counterOffer - prevOffer) * concessionRate
    );

    // レンジ内にクリップ
    proposed_amount = Math.max(proposed_amount, recommended_reward_min);
    proposed_amount = Math.min(proposed_amount, recommended_reward_max);

    rationale =
      `Round ${round}: 前回提案 ${prevOffer} JPYC、カウンター ${counterOffer} JPYC。` +
      `信頼スコア ${trustScore}（歩み寄り率 ${Math.round(concessionRate * 100)}%）に基づき、` +
      `${proposed_amount} JPYC に再提案します。`;

  } else if (bid) {
    // === 入札ベースの提案 ===
    const bidAmount = bid.bid_amount;

    // trust_scoreが高いほど入札額に近い額を提案
    // scoreFactor=1.0 → 入札額そのまま（上限クリップ）
    // scoreFactor=0.0 → 推奨最低額
    const bidWeight = scoreFactor;
    const baseAmount = recommended_reward_min +
      (recommended_reward_max - recommended_reward_min) * scoreFactor;

    // 入札額と信頼ベース額の加重平均
    proposed_amount = Math.round(
      baseAmount * (1 - bidWeight * 0.5) + bidAmount * (bidWeight * 0.5)
    );

    // レンジ内にクリップ
    proposed_amount = Math.max(proposed_amount, recommended_reward_min);
    proposed_amount = Math.min(proposed_amount, recommended_reward_max);

    // 入札のstatusを更新
    await supabase
      .from('mcp_bids')
      .update({ status: 'countered' })
      .eq('id', bid_id);

    rationale =
      `入札額: ${bidAmount} JPYC、信頼スコア: ${trustScore}（scoreFactor: ${Math.round(scoreFactor * 100) / 100}���、` +
      `タスク難易度: ${difficulty_score}、` +
      `報酬レンジ: ${recommended_reward_min}〜${recommended_reward_max} JPYC に基づき、` +
      `${proposed_amount} JPYC を提案します。`;

  } else {
    // === 従来互換（入札なし） ===
    proposed_amount = Math.round(
      recommended_reward_min +
      (recommended_reward_max - recommended_reward_min) * scoreFactor
    );

    rationale =
      `信頼スコア: ${trustScore}（scoreFactor: ${Math.round(scoreFactor * 100) / 100}）、` +
      `タスク難易度: ${difficulty_score}、` +
      `報酬レンジ: ${recommended_reward_min}〜${recommended_reward_max} JPYC に基づき、` +
      `${proposed_amount} JPYC を提案します。`;
  }

  // mcp_negotiations に INSERT
  const { data: negotiation, error: negError } = await supabase
    .from('mcp_negotiations')
    .insert({
      task_id,
      agent_wallet: normalized,
      proposed_amount,
      rationale,
      status: 'pending',
      bid_id: bid_id || null,
      round,
      agent_response: 'pending',
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
    round,
    bid_amount: bid?.bid_amount ?? null,
    trust_score: trustScore,
    rationale,
  };
}
