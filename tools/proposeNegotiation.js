/**
 * Tool 3 (v3): propose_negotiation
 * trust_score + 受注側の入札額を考慮して交渉条件を生成する
 */
import { db } from '../lib/db.js';

export default async function handler({ task_id, agent_wallet, bid_id }) {
  const { rows: taskRows } = await db.query(
    `SELECT difficulty_score, recommended_reward_min, recommended_reward_max FROM mcp_tasks WHERE id = $1`,
    [task_id]
  );
  const task = taskRows[0];
  if (!task) throw new Error(`タスクID ${task_id} が見つかりません`);

  const normalized = agent_wallet.toLowerCase();

  const { rows: agentRows } = await db.query(
    `SELECT id, trust_score FROM mcp_agents WHERE wallet_address = $1`,
    [normalized]
  );
  const agent = agentRows[0];
  const trustScore = agent?.trust_score ?? 0;
  const scoreFactor = Math.min(trustScore / 100, 1.0);
  const { recommended_reward_min, recommended_reward_max, difficulty_score } = task;

  let bid = null;
  if (bid_id) {
    const { rows: bidRows } = await db.query(`SELECT * FROM mcp_bids WHERE id = $1`, [bid_id]);
    bid = bidRows[0] ?? null;
  }

  const { rows: prevNegRows } = await db.query(
    `SELECT * FROM mcp_negotiations
     WHERE task_id = $1 AND agent_wallet = $2
     ORDER BY round DESC LIMIT 1`,
    [task_id, normalized]
  );
  const prevNeg = prevNegRows[0] ?? null;
  const round = prevNeg ? (prevNeg.round || 1) + 1 : 1;

  let proposed_amount;
  let rationale;

  if (prevNeg?.agent_response === 'countered' && prevNeg.agent_counter_amount) {
    const prevOffer = prevNeg.proposed_amount;
    const counterOffer = prevNeg.agent_counter_amount;
    const concessionRate = 0.3 + 0.6 * scoreFactor;
    proposed_amount = Math.round(prevOffer + (counterOffer - prevOffer) * concessionRate);
    proposed_amount = Math.max(proposed_amount, recommended_reward_min);
    proposed_amount = Math.min(proposed_amount, recommended_reward_max);
    rationale =
      `Round ${round}: 前回提案 ${prevOffer} JPYC、カウンター ${counterOffer} JPYC。` +
      `信頼スコア ${trustScore}（歩み寄り率 ${Math.round(concessionRate * 100)}%）に基づき、` +
      `${proposed_amount} JPYC に再提案します。`;

  } else if (bid) {
    const bidAmount = bid.bid_amount;
    const bidWeight = scoreFactor;
    const baseAmount = recommended_reward_min + (recommended_reward_max - recommended_reward_min) * scoreFactor;
    proposed_amount = Math.round(baseAmount * (1 - bidWeight * 0.5) + bidAmount * (bidWeight * 0.5));
    proposed_amount = Math.max(proposed_amount, recommended_reward_min);
    proposed_amount = Math.min(proposed_amount, recommended_reward_max);

    await db.query(`UPDATE mcp_bids SET status = 'countered' WHERE id = $1`, [bid_id]);

    rationale =
      `入札額: ${bidAmount} JPYC、信頼スコア: ${trustScore}（scoreFactor: ${Math.round(scoreFactor * 100) / 100}）、` +
      `タスク難易度: ${difficulty_score}、` +
      `報酬レンジ: ${recommended_reward_min}〜${recommended_reward_max} JPYC に基づき、` +
      `${proposed_amount} JPYC を提案します。`;

  } else {
    proposed_amount = Math.round(
      recommended_reward_min + (recommended_reward_max - recommended_reward_min) * scoreFactor
    );
    rationale =
      `信頼スコア: ${trustScore}（scoreFactor: ${Math.round(scoreFactor * 100) / 100}）、` +
      `タスク難易度: ${difficulty_score}、` +
      `報酬レンジ: ${recommended_reward_min}〜${recommended_reward_max} JPYC に基づき、` +
      `${proposed_amount} JPYC を提案します。`;
  }

  const { rows: negRows } = await db.query(
    `INSERT INTO mcp_negotiations
       (task_id, agent_wallet, proposed_amount, rationale, status, bid_id, round, agent_response)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'pending')
     RETURNING id`,
    [task_id, normalized, proposed_amount, rationale, bid_id || null, round]
  );

  await db.query(`UPDATE mcp_tasks SET status = 'negotiating' WHERE id = $1`, [task_id]);

  return {
    negotiation_id: negRows[0].id,
    proposed_amount,
    round,
    bid_amount: bid?.bid_amount ?? null,
    trust_score: trustScore,
    rationale,
  };
}
