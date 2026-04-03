import { calculateTrustScore } from './lib/trustScore.js';

// 設計書の算出式に基づく正確な期待値でテスト
const cases = [
  // 基本ケース
  { name: '新規(全て0)', params: { completion_count: 0, smoothed_rate: 0.5, active_months: 0, avg_sentiment: 0.5, recent_failure_rate: 0 }, expected: 0 },
  { name: '完遂1件', params: { completion_count: 1, smoothed_rate: (1+1)/(1+2), active_months: 1, avg_sentiment: 0.7, recent_failure_rate: 0 }, expected: 5.67 },
  { name: '完遂10件', params: { completion_count: 10, smoothed_rate: (10+1)/(11+2), active_months: 2, avg_sentiment: 0.75, recent_failure_rate: 0 }, expected: 38.85 },
  { name: '完遂50件', params: { completion_count: 50, smoothed_rate: (50+1)/(53+2), active_months: 5, avg_sentiment: 0.8, recent_failure_rate: 0 }, expected: 100.63 },
  { name: '完遂100件', params: { completion_count: 100, smoothed_rate: (100+1)/(105+2), active_months: 8, avg_sentiment: 0.85, recent_failure_rate: 0 }, expected: 141.85 },
  // 失敗率ペナルティ: 15%減衰 → スコア * 0.85
  { name: '完遂100件+失敗率15%', params: { completion_count: 100, smoothed_rate: (100+1)/(105+2), active_months: 8, avg_sentiment: 0.85, recent_failure_rate: 0.15 }, expected: 120.57 },

  // 追加: cancelled_by_agent相当（total_task_countが多くsmoothed_rateが低い）
  { name: 'キャンセル3回あり(完遂10/総数14)', params: { completion_count: 10, smoothed_rate: (10+1)/(14+2), active_months: 2, avg_sentiment: 0.75, recent_failure_rate: 0 }, expected: null },
];

let allPass = true;
for (const c of cases) {
  const result = calculateTrustScore(c.params);

  if (c.expected === null) {
    // cancelled_by_agentケース: smoothed_rateが低下していることを確認
    const normalRate = (10+1)/(11+2); // 0.846
    const degradedRate = c.params.smoothed_rate; // 0.6875
    const pass = degradedRate < normalRate && result > 0;
    if (!pass) allPass = false;
    console.log(pass ? '✓' : '✗', c.name, '→', result, `(smoothed_rate低下: ${normalRate.toFixed(3)} → ${degradedRate.toFixed(3)})`);
  } else {
    const pass = Math.abs(result - c.expected) <= 0.1;
    if (!pass) allPass = false;
    console.log(pass ? '✓' : '✗', c.name, '→', result, '(期待:', c.expected, ')');
  }
}

// 単調増加テスト: 完遂数が増えるほどスコアが上がる
const s1 = calculateTrustScore({ completion_count: 10, smoothed_rate: 0.85, active_months: 2, avg_sentiment: 0.75, recent_failure_rate: 0 });
const s2 = calculateTrustScore({ completion_count: 50, smoothed_rate: 0.93, active_months: 5, avg_sentiment: 0.80, recent_failure_rate: 0 });
const s3 = calculateTrustScore({ completion_count: 100, smoothed_rate: 0.94, active_months: 8, avg_sentiment: 0.85, recent_failure_rate: 0 });
const monotonic = s1 < s2 && s2 < s3;
if (!monotonic) allPass = false;
console.log(monotonic ? '✓' : '✗', `単調増加: ${s1.toFixed(1)} < ${s2.toFixed(1)} < ${s3.toFixed(1)}`);

// failure_decay下限テスト: 失敗率100%でもスコア > 0（下限0.1）
const extreme = calculateTrustScore({ completion_count: 10, smoothed_rate: 0.85, active_months: 2, avg_sentiment: 0.75, recent_failure_rate: 1.0 });
const extremePass = extreme > 0;
if (!extremePass) allPass = false;
console.log(extremePass ? '✓' : '✗', `failure_decay下限: 失敗率100%でもスコア=${extreme} > 0`);

console.log(allPass ? '\n全テスト合格' : '\n一部テスト不合格');
process.exit(allPass ? 0 : 1);
