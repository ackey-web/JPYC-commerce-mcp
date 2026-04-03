/**
 * 信頼スコアv2 算出関数
 *
 * trust_score = volume × reliability × longevity × reputation × failure_decay
 */

/**
 * @param {Object} params
 * @param {number} params.completion_count - 完遂タスク数
 * @param {number} params.smoothed_rate - ラプラス平滑化済み完遂率
 * @param {number} params.active_months - 完遂実績のあるユニーク月数
 * @param {number} params.avg_sentiment - 平均センチメント (0.0〜1.0)
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
