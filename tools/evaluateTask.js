/**
 * Tool 2 (v2): evaluate_task
 * タスク内容を査定して難易度と推奨報酬レンジを算出する
 */
import { db } from '../lib/db.js';
import { calculateSkillScore, analyzeTaskComplexity } from '../lib/taskAnalyzer.js';

export default async function handler({ description, required_skills, deadline }) {
  const { weightedScore: skillScore, breakdown: skillBreakdown } = calculateSkillScore(required_skills);

  const daysUntilDeadline = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
  let deadlineBonus;
  if (daysUntilDeadline <= 3) deadlineBonus = 0.30;
  else if (daysUntilDeadline <= 7) deadlineBonus = 0.20;
  else if (daysUntilDeadline <= 14) deadlineBonus = 0.10;
  else deadlineBonus = 0.05;

  const aiAnalysis = await analyzeTaskComplexity(description, required_skills);

  let difficulty_score;
  let scoring_method;

  if (aiAnalysis) {
    difficulty_score = Math.min(skillScore * 0.3 + deadlineBonus * 0.1 + aiAnalysis.complexity * 0.6, 1.0);
    difficulty_score = Math.max(difficulty_score, aiAnalysis.complexity * 0.5);
    difficulty_score = Math.min(difficulty_score, 1.0);
    scoring_method = 'ai_enhanced';
  } else {
    difficulty_score = Math.min(skillScore + deadlineBonus, 1.0);
    scoring_method = 'formula_only';
  }

  difficulty_score = Math.round(difficulty_score * 1000) / 1000;

  const recommended_reward_min = Math.round(100 + 900 * difficulty_score * 0.6);
  const recommended_reward_max = Math.round(100 + 900 * difficulty_score);

  const { rows } = await db.query(
    `INSERT INTO mcp_tasks
       (description, required_skills, deadline, difficulty_score, recommended_reward_min, recommended_reward_max, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [description, required_skills, deadline, difficulty_score, recommended_reward_min, recommended_reward_max]
  );

  const result = {
    task_id: rows[0].id,
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
