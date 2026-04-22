/**
 * Tool 10: set_rate_card
 * エージェントオーナーがスキル別の希望単価を事前登録する
 */
import { db } from '../lib/db.js';

export default async function handler({ agent_wallet, rates, auto_bid_enabled, max_bid_amount }) {
  const normalized = agent_wallet.toLowerCase();

  const { rows } = await db.query(`SELECT id FROM mcp_agents WHERE wallet_address = $1`, [normalized]);
  if (!rows[0]) throw new Error(`エージェント ${agent_wallet} が未登録です。先に get_sbt_profile で登録してください`);

  if (!rates || !Array.isArray(rates) || rates.length === 0) {
    throw new Error('rates は [{skill, rate_per_task, min_acceptable}] の配列で指定してください');
  }
  for (const r of rates) {
    if (!r.skill || !r.rate_per_task || r.rate_per_task <= 0) throw new Error(`無効なレート: skill="${r.skill}"`);
    if (r.min_acceptable && r.min_acceptable > r.rate_per_task) throw new Error(`min_acceptable が rate_per_task を超えています: ${r.skill}`);
  }

  for (const r of rates) {
    await db.query(
      `INSERT INTO mcp_rate_cards (agent_wallet, skill, rate_per_task, min_acceptable, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (agent_wallet, skill) DO UPDATE SET rate_per_task = $3, min_acceptable = $4, updated_at = NOW()`,
      [normalized, r.skill.toLowerCase(), r.rate_per_task, r.min_acceptable || null]
    );
  }

  if (auto_bid_enabled !== undefined || max_bid_amount !== undefined) {
    const setClauses = [];
    const params = [normalized];
    if (auto_bid_enabled !== undefined) { setClauses.push(`auto_bid_enabled = $${params.push(auto_bid_enabled)}`); }
    if (max_bid_amount !== undefined) { setClauses.push(`max_bid_amount = $${params.push(max_bid_amount)}`); }
    await db.query(`UPDATE mcp_agents SET ${setClauses.join(', ')} WHERE wallet_address = $1`, params);
  }

  const { rows: allRates } = await db.query(
    `SELECT skill, rate_per_task, min_acceptable FROM mcp_rate_cards WHERE agent_wallet = $1 ORDER BY skill`,
    [normalized]
  );

  return {
    agent_wallet: normalized,
    rates_count: allRates.length,
    rates: allRates,
    auto_bid_enabled: auto_bid_enabled ?? false,
    max_bid_amount: max_bid_amount ?? 1000,
    message: `${rates.length} 件の料金を登録しました`,
  };
}
