/**
 * Tool 8 (v2): submit_bid
 * 受注側エージェントがタスクに対して入札する。
 * bounty_id が指定された場合は BountyEscrow.submitBid の calldata も返す（ノンカストディアル）。
 *
 * bidAmount について:
 *   submitBid(jobKey, bidAmount, proposalHash) の bidAmount は参考値として記録されるが、
 *   実際の支払い額は Job.amount（openBounty 時に確定）で固定される。
 *   team-lead 方針: bidAmount 廃止案は不採用、現行シグネチャ維持。
 */
import { db } from '../lib/db.js';
import { buildSubmitBidInstruction } from '../lib/bountyCalldataBuilder.js';

export default async function handler({ task_id, agent_wallet, bid_amount, message, bounty_id, deliverable_hash }) {
  const normalized = agent_wallet.toLowerCase();

  const { rows: taskRows } = await db.query(`SELECT * FROM mcp_tasks WHERE id = $1`, [task_id]);
  const task = taskRows[0];
  if (!task) throw new Error(`タスクID ${task_id} が見つかりません`);
  if (task.status !== 'pending') throw new Error(`このタスクは既に ${task.status} 状態です`);

  let { rows: agentRows } = await db.query(
    `SELECT id, trust_score, auto_bid_enabled, max_bid_amount FROM mcp_agents WHERE wallet_address = $1`,
    [normalized]
  );
  let agent = agentRows[0] ?? null;
  if (!agent) {
    const { rows: inserted } = await db.query(
      `INSERT INTO mcp_agents (wallet_address) VALUES ($1) RETURNING id, trust_score, auto_bid_enabled, max_bid_amount`,
      [normalized]
    );
    agent = inserted[0];
  }

  const maxBid = agent.max_bid_amount || 1000;
  let finalBidAmount, bidSource;

  if (bid_amount != null) {
    if (bid_amount > maxBid) throw new Error(`入札額 ${bid_amount} JPYC がオーナー設定の上限 ${maxBid} JPYC を超えています`);
    finalBidAmount = bid_amount;
    bidSource = 'manual';
  } else {
    const taskSkills = (task.required_skills || []).map((s) => s.toLowerCase());
    const { rows: rateRows } = await db.query(
      `SELECT skill, rate_per_task FROM mcp_rate_cards WHERE agent_wallet = $1 AND skill = ANY($2)`,
      [normalized, taskSkills]
    );
    if (!rateRows || rateRows.length === 0) {
      throw new Error(`料金表が未設定です。set_rate_card で設定してください。必要スキル: ${taskSkills.join(', ')}`);
    }
    finalBidAmount = Math.min(Math.max(...rateRows.map((r) => r.rate_per_task)), maxBid);
    bidSource = `rate_card (${rateRows.map((r) => `${r.skill}=${r.rate_per_task}`).join(', ')})`;
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM mcp_bids WHERE task_id = $1 AND agent_wallet = $2 AND status = 'pending'`,
    [task_id, normalized]
  );
  if (existing[0]) throw new Error('このタスクに対して既にpendingの入札があります');

  let warning = null;
  if (finalBidAmount < task.recommended_reward_min) warning = `入札額 ${finalBidAmount} JPYC は推奨最低額 ${task.recommended_reward_min} JPYC を下回っています`;
  else if (finalBidAmount > task.recommended_reward_max) warning = `入札額 ${finalBidAmount} JPYC は推奨上限額 ${task.recommended_reward_max} JPYC を超えています`;

  const { rows: bidRows } = await db.query(
    `INSERT INTO mcp_bids (task_id, agent_wallet, bid_amount, message, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [task_id, normalized, finalBidAmount, message || null]
  );
  if (!bidRows[0]) throw new Error('入札記録失敗');

  const result = {
    bid_id: bidRows[0].id, task_id, agent_wallet: normalized, bid_amount: finalBidAmount,
    bid_source: bidSource, max_bid_amount: maxBid, trust_score: agent.trust_score,
    recommended_range: { min: task.recommended_reward_min, max: task.recommended_reward_max },
    warning,
  };

  // BountyEscrow フロー：bounty_id が指定されている場合はオンチェーン入札 calldata も返す
  if (bounty_id) {
    const { rows: bountyRows } = await db.query(
      `SELECT * FROM mcp_bounties WHERE id = $1 AND status = 'open'`,
      [bounty_id]
    );
    const bounty = bountyRows[0];
    if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つからないか open 状態ではありません`);
    if (!bounty.job_key) {
      throw new Error('job_key が未設定です。openBounty トランザクション後に report_tx_hash で登録してください');
    }

    // mcp_bounty_bids に記録
    await db.query(
      `INSERT INTO mcp_bounty_bids (bounty_id, bidder_wallet, bid_amount, deliverable_hash, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [bounty_id, normalized, finalBidAmount, deliverable_hash || null]
    );

    result.bounty_id = bounty_id;
    result.tx_instruction = buildSubmitBidInstruction(
      bounty.job_key,
      finalBidAmount,
      deliverable_hash || '0x' + '0'.repeat(64)
    );
    result.next_step = 'tx_instruction のトランザクションを実行後、report_tx_hash で onchain_bid_id を登録してください';
  }

  return result;
}
