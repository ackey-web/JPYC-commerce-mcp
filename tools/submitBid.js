/**
 * Tool 8 (v2): submit_bid
 * 受注側エージェントがタスクに対して入札する
 *
 * 金額決定の優先順位:
 * 1. bid_amount が明示指定された場合 → その額を使用（ただし max_bid_amount 以下）
 * 2. bid_amount 省略 → rate_card からタスクのrequired_skillsに基づいて自動算出
 * 3. rate_card にも該当なし → エラー（人間が料金設定していない）
 *
 * 制約:
 * - bid_amount は max_bid_amount を超えられない（オーナーが上限を設定）
 * - min_acceptable 未満の提案は respond_to_offer で自動拒否の参考値
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
    .select('id, trust_score, auto_bid_enabled, max_bid_amount')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!agent) {
    const { data: newAgent } = await supabase
      .from('mcp_agents')
      .insert({ wallet_address: normalized })
      .select('id, trust_score, auto_bid_enabled, max_bid_amount')
      .single();
    agent = newAgent;
  }

  const maxBid = agent.max_bid_amount || 1000;

  // --- 金額決定 ---
  let finalBidAmount;
  let bidSource;

  if (bid_amount != null) {
    // 明示指定
    if (bid_amount > maxBid) {
      throw new Error(
        `入札額 ${bid_amount} JPYC がオーナー設定の上限 ${maxBid} JPYC を超えています。` +
        `set_rate_card で max_bid_amount を変更するか、${maxBid} JPYC 以下で入札してください`
      );
    }
    finalBidAmount = bid_amount;
    bidSource = 'manual';
  } else {
    // rate_card から自動算出
    const taskSkills = (task.required_skills || []).map((s) => s.toLowerCase());

    const { data: rateCards } = await supabase
      .from('mcp_rate_cards')
      .select('skill, rate_per_task')
      .eq('agent_wallet', normalized)
      .in('skill', taskSkills);

    if (!rateCards || rateCards.length === 0) {
      throw new Error(
        `料金表が未設定です。人間がオーナーとして set_rate_card で料金を設定してから入札してください。` +
        `必要スキル: ${taskSkills.join(', ')}`
      );
    }

    // マッチしたスキルの最大単価を入札額とする
    const matchedRates = rateCards.map((r) => r.rate_per_task);
    finalBidAmount = Math.max(...matchedRates);

    // max_bid_amount でクリップ
    if (finalBidAmount > maxBid) {
      finalBidAmount = maxBid;
    }

    bidSource = `rate_card (${rateCards.map((r) => `${r.skill}=${r.rate_per_task}`).join(', ')})`;
  }

  // 重複入札チェック
  const { data: existingBid } = await supabase
    .from('mcp_bids')
    .select('id')
    .eq('task_id', task_id)
    .eq('agent_wallet', normalized)
    .eq('status', 'pending')
    .maybeSingle();

  if (existingBid) {
    throw new Error('このタスクに対して既にpendingの入札があります');
  }

  // 入札額のレンジチェック（警告のみ）
  let warning = null;
  if (finalBidAmount < task.recommended_reward_min) {
    warning = `入札額 ${finalBidAmount} JPYC は推奨最低額 ${task.recommended_reward_min} JPYC を下回っています`;
  } else if (finalBidAmount > task.recommended_reward_max) {
    warning = `入札額 ${finalBidAmount} JPYC は推奨上限額 ${task.recommended_reward_max} JPYC を超えています`;
  }

  // 入札記録
  const { data: bid, error: bidError } = await supabase
    .from('mcp_bids')
    .insert({
      task_id,
      agent_wallet: normalized,
      bid_amount: finalBidAmount,
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
    bid_amount: finalBidAmount,
    bid_source: bidSource,
    max_bid_amount: maxBid,
    trust_score: agent.trust_score,
    recommended_range: {
      min: task.recommended_reward_min,
      max: task.recommended_reward_max,
    },
    warning,
  };
}
