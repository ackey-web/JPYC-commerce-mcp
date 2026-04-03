/**
 * Tool 2 (v2): evaluate_task
 * タスク内容を査定して難易度と推奨報酬レンジを算出する
 *
 * 査定方式:
 * 1. スキル重み付き基礎スコア（スキルの希少性・難易度を反映）
 * 2. 期限プレッシャー加算
 * 3. Claude APIによるタスク複雑度分析（利用可能な場合）
 * 4. 3つのシグナルを統合して最終スコアを算出
 */
import { supabase } from '../lib/supabase.js';
import { calculateSkillScore, analyzeTaskComplexity } from '../lib/taskAnalyzer.js';

export default async function handler({ description, required_skills, deadline }) {
  // --- 1. スキル重み付きスコア ---
  const { weightedScore: skillScore, breakdown: skillBreakdown } = calculateSkillScore(required_skills);

  // --- 2. 期限プレッシャー ---
  const daysUntilDeadline = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
  let deadlineBonus;
  if (daysUntilDeadline <= 3) {
    deadlineBonus = 0.30;
  } else if (daysUntilDeadline <= 7) {
    deadlineBonus = 0.20;
  } else if (daysUntilDeadline <= 14) {
    deadlineBonus = 0.10;
  } else {
    deadlineBonus = 0.05;
  }

  // --- 3. AI複雑度分析（フォールバック対応） ---
  const aiAnalysis = await analyzeTaskComplexity(description, required_skills);

  // --- 4. 最終スコア統合 ---
  let difficulty_score;
  let scoring_method;

  if (aiAnalysis) {
    // AI分析あり: スキルスコア(30%) + 期限(10%) + AI複雑度(60%)
    difficulty_score = Math.min(
      skillScore * 0.3 + deadlineBonus * 0.1 + aiAnalysis.complexity * 0.6,
      1.0
    );
    // difficulty_scoreが極端に低くならないようフロアを設ける
    difficulty_score = Math.max(difficulty_score, aiAnalysis.complexity * 0.5);
    difficulty_score = Math.min(difficulty_score, 1.0);
    scoring_method = 'ai_enhanced';
  } else {
    // AI分析なし: 従来方式（スキルスコア + 期限）
    difficulty_score = Math.min(skillScore + deadlineBonus, 1.0);
    scoring_method = 'formula_only';
  }

  // 小数第3位まで丸め
  difficulty_score = Math.round(difficulty_score * 1000) / 1000;

  // --- 5. 推奨報酬レンジ ---
  const recommended_reward_min = Math.round(100 + 900 * difficulty_score * 0.6);
  const recommended_reward_max = Math.round(100 + 900 * difficulty_score);

  // --- 6. mcp_tasks に INSERT ---
  const { data, error } = await supabase
    .from('mcp_tasks')
    .insert({
      description,
      required_skills,
      deadline,
      difficulty_score,
      recommended_reward_min,
      recommended_reward_max,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`mcp_tasks 保存失敗: ${error.message}`);
  }

  // --- 7. 結果返却 ---
  const result = {
    task_id: data.id,
    difficulty_score,
    recommended_reward_min,
    recommended_reward_max,
    scoring_method,
    skill_breakdown: skillBreakdown,
  };

  if (aiAnalysis) {
    result.ai_analysis = {
      complexity: aiAnalysis.complexity,
      estimated_hours: aiAnalysis.estimated_hours,
      risk_factors: aiAnalysis.risk_factors,
      rationale: aiAnalysis.rationale,
    };
  }

  return result;
}
