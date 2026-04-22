/**
 * Tool 9: respond_to_offer
 * 受注側エージェントが発注側の交渉提案に対して応答する
 */
import { db } from '../lib/db.js';

export default async function handler({ negotiation_id, response, counter_amount, message }) {
  const { rows: negRows } = await db.query(
    `SELECT * FROM mcp_negotiations WHERE id = $1`,
    [negotiation_id]
  );
  const negotiation = negRows[0];
  if (!negotiation) throw new Error(`交渉ID ${negotiation_id} が見つかりません`);

  if (negotiation.status !== 'pending') {
    throw new Error(`この交渉は既に ${negotiation.status} 状態です。応答できるのは pending の交渉のみです`);
  }
  if (negotiation.agent_response && negotiation.agent_response !== 'pending') {
    throw new Error(`この交渉には既に応答済みです (${negotiation.agent_response})`);
  }

  const { rows: taskRows } = await db.query(
    `SELECT recommended_reward_min, recommended_reward_max FROM mcp_tasks WHERE id = $1`,
    [negotiation.task_id]
  );
  const task = taskRows[0];

  const result = { negotiation_id, response, previous_amount: negotiation.proposed_amount };

  if (response === 'accepted') {
    await db.query(
      `UPDATE mcp_negotiations SET agent_response = 'accepted', agent_message = $1, status = 'approved' WHERE id = $2`,
      [message || null, negotiation_id]
    );
    await db.query(`UPDATE mcp_tasks SET status = 'approved' WHERE id = $1`, [negotiation.task_id]);
    result.final_amount = negotiation.proposed_amount;
    result.next_step = 'execute_payment';
    result.message = `${negotiation.proposed_amount} JPYC で合意。execute_payment で送金を実行してください`;

  } else if (response === 'rejected') {
    await db.query(
      `UPDATE mcp_negotiations SET agent_response = 'rejected', agent_message = $1, status = 'rejected' WHERE id = $2`,
      [message || null, negotiation_id]
    );
    if (negotiation.bid_id) {
      await db.query(`UPDATE mcp_bids SET status = 'rejected' WHERE id = $1`, [negotiation.bid_id]);
    }
    await db.query(`UPDATE mcp_tasks SET status = 'pending' WHERE id = $1`, [negotiation.task_id]);
    result.message = '交渉を拒否しました。タスクは再度入札可能な状態に戻りました';
    result.next_step = 'submit_bid (new agent) or propose_negotiation (revised offer)';

  } else if (response === 'countered') {
    if (!counter_amount || counter_amount <= 0) {
      throw new Error('countered の場合は counter_amount（希望額）が必要です');
    }
    let warning = null;
    if (task && counter_amount > task.recommended_reward_max * 1.5) {
      warning = `カウンター額 ${counter_amount} JPYC は推奨上限の1.5倍を超えています`;
    }
    await db.query(
      `UPDATE mcp_negotiations SET agent_response = 'countered', agent_counter_amount = $1, agent_message = $2 WHERE id = $3`,
      [counter_amount, message || null, negotiation_id]
    );
    result.counter_amount = counter_amount;
    result.warning = warning;
    result.message = `${counter_amount} JPYC でカウンターオファーを提示しました。発注側は propose_negotiation で再提案するか、この額で合意できます`;
    result.next_step = 'propose_negotiation (round 2) or request_human_approval (accept counter)';

  } else {
    throw new Error(`無効な応答: ${response}。accepted / rejected / countered のいずれかを指定してください`);
  }

  return result;
}
