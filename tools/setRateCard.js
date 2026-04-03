/**
 * Tool 10: set_rate_card
 * エージェントオーナーがスキル別の希望単価を事前登録する
 *
 * 人間が設定 → エージェントはこの範囲内でしか入札できない
 * これにより受注エージェントが勝手に金額を決める問題を防止
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ agent_wallet, rates, auto_bid_enabled, max_bid_amount }) {
  const normalized = agent_wallet.toLowerCase();

  // エージェント存在確認
  const { data: agent } = await supabase
    .from('mcp_agents')
    .select('id')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!agent) {
    throw new Error(`エージェント ${agent_wallet} が未登録です。先に get_sbt_profile で登録してください`);
  }

  // バリデーション
  if (!rates || !Array.isArray(rates) || rates.length === 0) {
    throw new Error('rates は [{skill, rate_per_task, min_acceptable}] の配列で指定してください');
  }

  for (const r of rates) {
    if (!r.skill || !r.rate_per_task || r.rate_per_task <= 0) {
      throw new Error(`無効なレート: skill="${r.skill}", rate_per_task=${r.rate_per_task}`);
    }
    if (r.min_acceptable && r.min_acceptable > r.rate_per_task) {
      throw new Error(`min_acceptable (${r.min_acceptable}) が rate_per_task (${r.rate_per_task}) を超えています: ${r.skill}`);
    }
  }

  // upsert（既存のスキルは上書き）
  const records = rates.map((r) => ({
    agent_wallet: normalized,
    skill: r.skill.toLowerCase(),
    rate_per_task: r.rate_per_task,
    min_acceptable: r.min_acceptable || null,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from('mcp_rate_cards')
    .upsert(records, { onConflict: 'agent_wallet,skill' });

  if (upsertError) {
    throw new Error(`料金表保存失敗: ${upsertError.message}`);
  }

  // auto_bid設定を更新
  const updates = {};
  if (auto_bid_enabled !== undefined) updates.auto_bid_enabled = auto_bid_enabled;
  if (max_bid_amount !== undefined) updates.max_bid_amount = max_bid_amount;

  if (Object.keys(updates).length > 0) {
    await supabase
      .from('mcp_agents')
      .update(updates)
      .eq('wallet_address', normalized);
  }

  // 登録済みの全レートを返す
  const { data: allRates } = await supabase
    .from('mcp_rate_cards')
    .select('skill, rate_per_task, min_acceptable')
    .eq('agent_wallet', normalized)
    .order('skill');

  return {
    agent_wallet: normalized,
    rates_count: allRates?.length || 0,
    rates: allRates || [],
    auto_bid_enabled: auto_bid_enabled ?? false,
    max_bid_amount: max_bid_amount ?? 1000,
    message: `${records.length} 件の料金を登録しました`,
  };
}
