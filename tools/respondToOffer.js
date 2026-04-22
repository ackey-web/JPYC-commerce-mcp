/**
 * Tool 9 (v2): respond_to_offer
 * 受注側エージェントが発注側の交渉提案に対して応答する
 *
 * 状態遷移:
 *   pending → accepted  (status: accepted)
 *   pending → rejected  (status: rejected)
 *   pending → countered (status: pending, agent_response: countered)
 *   期限切れ → expired に更新してエラー
 */
import { db } from '../lib/db.js';

const HUMAN_APPROVAL_THRESHOLD = parseInt(process.env.HUMAN_APPROVAL_THRESHOLD_JPYC || '1000', 10);

const VALID_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'countered'],
};

export default async function handler({ negotiation_id, response, counter_amount, message }) {
  const { rows: negRows } = await db.query(
    `SELECT * FROM mcp_negotiations WHERE id = $1`,
    [negotiation_id]
  );
  const negotiation = negRows[0];
  if (!negotiation) throw new Error(`交渉ID ${negotiation_id} が見つかりません`);

  // 有効期限の lazy チェック
  if (negotiation.expires_at && new Date(negotiation.expires_at) < new Date()) {
    if (negotiation.status !== 'expired') {
      await db.query(
        `UPDATE mcp_negotiations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [negotiation_id]
      );
    }
    throw new Error(`この交渉は有効期限切れです (expires_at: ${negotiation.expires_at})`);
  }

  // 状態ガード
  const allowedResponses = VALID_TRANSITIONS[negotiation.status];
  if (!allowedResponses) {
    throw new Error(
      `この交渉は ${negotiation.status} 状態です。応答できるのは pending の交渉のみです`
    );
  }
  if (!allowedResponses.includes(response)) {
    throw new Error(
      `${negotiation.status} 状態では "${response}" は無効です。` +
      `有効な応答: ${allowedResponses.join(' / ')}`
    );
  }

  const { rows: taskRows } = await db.query(
    `SELECT recommended_reward_min, recommended_reward_max FROM mcp_tasks WHERE id = $1`,
    [negotiation.task_id]
  );
  const task = taskRows[0];

  const result = {
    negotiation_id,
    response,
    previous_amount: negotiation.proposed_amount,
    round: negotiation.round,
  };

  if (response === 'accepted') {
    const humanRequired =
      negotiation.human_approval_required ||
      negotiation.proposed_amount >= HUMAN_APPROVAL_THRESHOLD;

    await db.query(
      `UPDATE mcp_negotiations
       SET agent_response = 'accepted', agent_message = $1, status = 'accepted', updated_at = NOW()
       WHERE id = $2`,
      [message || null, negotiation_id]
    );
    await db.query(`UPDATE mcp_tasks SET status = 'approved' WHERE id = $1`, [negotiation.task_id]);

    result.final_amount = negotiation.proposed_amount;
    result.human_approval_required = humanRequired;

    if (humanRequired) {
      result.next_step = 'request_human_approval';
      result.message =
        `${negotiation.proposed_amount} JPYC で合意。` +
        `金額が閾値 ${HUMAN_APPROVAL_THRESHOLD} JPYC 以上のため、request_human_approval で人間承認が必要です`;
    } else {
      result.next_step = 'execute_payment';
      result.message =
        `${negotiation.proposed_amount} JPYC で合意。execute_payment で送金calldata を取得してください`;
    }

  } else if (response === 'rejected') {
    await db.query(
      `UPDATE mcp_negotiations
       SET agent_response = 'rejected', agent_message = $1, status = 'rejected', updated_at = NOW()
       WHERE id = $2`,
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

    // counter_history に今回のカウンターを追記
    const history = negotiation.counter_history ?? [];
    history.push({
      round: negotiation.round,
      proposed: negotiation.proposed_amount,
      counter: counter_amount,
      ts: new Date().toISOString(),
    });

    await db.query(
      `UPDATE mcp_negotiations
       SET agent_response = 'countered', agent_counter_amount = $1, agent_message = $2,
           status = 'countered', counter_history = $3, updated_at = NOW()
       WHERE id = $4`,
      [counter_amount, message || null, JSON.stringify(history), negotiation_id]
    );

    result.counter_amount = counter_amount;
    result.warning = warning;
    result.message =
      `${counter_amount} JPYC でカウンターオファーを提示しました。` +
      `発注側は propose_negotiation で再提案するか、この額を承認できます`;
    result.next_step = 'propose_negotiation (next round)';
  }

  return result;
}
