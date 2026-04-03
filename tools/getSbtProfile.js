/**
 * Tool 1 (v2): get_sbt_profile
 * エージェントのプロフィール（信頼スコア・実績・評価）を取得する
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ wallet_address }) {
  const normalized = wallet_address.toLowerCase();

  // 既存レコードを検索
  const { data, error } = await supabase
    .from('mcp_agents')
    .select('id, trust_score, completion_count, total_task_count, smoothed_rate, active_months, avg_sentiment, sentiment_count')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`mcp_agents 検索失敗: ${error.message}`);
  }

  if (data) {
    return data;
  }

  // 存在しない場合は初期値で新規作成
  const { data: inserted, error: insertError } = await supabase
    .from('mcp_agents')
    .insert({
      wallet_address: normalized,
      trust_score: 0.0,
      completion_count: 0,
      total_task_count: 0,
      smoothed_rate: 0.5,
      active_months: 0,
      avg_sentiment: 0.5,
      sentiment_count: 0,
    })
    .select('id, trust_score, completion_count, total_task_count, smoothed_rate, active_months, avg_sentiment, sentiment_count')
    .single();

  if (insertError) {
    throw new Error(`mcp_agents 新規作成失敗: ${insertError.message}`);
  }

  return inserted;
}
