/**
 * 信頼スコア v3 算出関数
 *
 * trust_score = volume x reliability x longevity x reputation x failure_decay
 *
 * 3つのロールで同じ式を使い回す:
 * - task (タスク外注): completion_count = タスク完遂数
 * - seller (売り手): completion_count = 取引完了数（発送→受取確認）
 * - buyer (買い手): completion_count = 取引完了数（支払い→受取確認→評価）
 */

/**
 * @param {Object} params
 * @param {number} params.completion_count - 完了数
 * @param {number} params.smoothed_rate - ラプラス平滑化済み完了率
 * @param {number} params.active_months - 実績のあるユニーク月数
 * @param {number} params.avg_sentiment - 平均評価 (0.0〜1.0)
 * @param {number} params.recent_failure_rate - 直近30日の失敗率
 * @returns {number} 信頼スコア（小数第2位まで）
 */
export function calculateTrustScore({
  completion_count,
  smoothed_rate,
  active_months,
  avg_sentiment,
  recent_failure_rate,
}) {
  if (completion_count === 0) return 0;

  const volume = 10 * Math.log2(1 + completion_count);
  const reliability = Math.pow(smoothed_rate, 2);
  const longevity = 1 + 0.5 * Math.log2(1 + active_months);
  const reputation = 0.5 + 0.5 * avg_sentiment;
  const failureDecay = Math.max(0.1, 1 - recent_failure_rate);

  const score = volume * reliability * longevity * reputation * failureDecay;
  return Math.round(score * 100) / 100;
}

/**
 * ロール別のスコアを算出するヘルパー
 *
 * @param {Object} agent - mcp_agents レコード
 * @param {'task' | 'seller' | 'buyer'} role
 * @param {number} recentFailureRate - 直近30日の失敗率
 * @returns {number}
 */
export function calculateRoleScore(agent, role, recentFailureRate = 0) {
  if (role === 'seller') {
    return calculateTrustScore({
      completion_count: agent.seller_completion_count || 0,
      smoothed_rate: ((agent.seller_completion_count || 0) + 1) / ((agent.seller_total_count || 0) + 2),
      active_months: agent.active_months || 0,
      avg_sentiment: agent.seller_avg_sentiment ?? 0.5,
      recent_failure_rate: recentFailureRate,
    });
  }

  if (role === 'buyer') {
    return calculateTrustScore({
      completion_count: agent.buyer_completion_count || 0,
      smoothed_rate: ((agent.buyer_completion_count || 0) + 1) / ((agent.buyer_total_count || 0) + 2),
      active_months: agent.active_months || 0,
      avg_sentiment: agent.buyer_avg_sentiment ?? 0.5,
      recent_failure_rate: recentFailureRate,
    });
  }

  // task (default)
  return calculateTrustScore({
    completion_count: agent.completion_count || 0,
    smoothed_rate: agent.smoothed_rate || 0.5,
    active_months: agent.active_months || 0,
    avg_sentiment: agent.avg_sentiment ?? 0.5,
    recent_failure_rate: recentFailureRate,
  });
}
