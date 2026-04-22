/**
 * Tool 6 (v2): update_agent_record
 * タスク完了後にエージェントの信頼スコアを更新する
 * SEC-1: recent_failure_rate は pg カウントクエリで正確に算出
 * SEC-2: active_months は count_active_months SQL 関数（DISTINCT 月）で算出
 */
import { db } from '../lib/db.js';
import { calculateTrustScore } from '../lib/trustScore.js';
import { buildMerkleTree } from '../lib/merkle.js';
import {
  getSbtTokenId,
  buildMintCalldata,
  buildUpdateTrustScoreCalldata,
} from '../lib/sbtClient.js';

export default async function handler({ agent_id, task_id, task_result, sentiment }) {
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO mcp_task_results (agent_id, task_id, result, sentiment_given, resolved_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [agent_id, task_id, task_result, sentiment ?? null, now]
  );

  if (task_result === 'cancelled_by_client') {
    return { trust_score: null, message: '発注側キャンセル: エージェントスコアに影響なし' };
  }

  const effectiveResult = task_result === 'cancelled_by_agent' ? 'failed' : task_result;

  const { rows } = await db.query(`SELECT * FROM mcp_agents WHERE id = $1`, [agent_id]);
  const agent = rows[0];
  if (!agent) throw new Error(`エージェントID ${agent_id} が見つかりません`);

  const totalTaskCount = agent.total_task_count + 1;
  let completionCount = agent.completion_count;
  const updates = { total_task_count: totalTaskCount, updated_at: now };

  if (effectiveResult === 'completed') {
    completionCount = agent.completion_count + 1;
    updates.completion_count = completionCount;
    updates.last_completed_at = now;
  } else {
    updates.completion_count = completionCount;
    updates.last_failed_at = now;
  }

  if (!agent.first_task_at) updates.first_task_at = now;

  updates.smoothed_rate = (completionCount + 1) / (totalTaskCount + 2);

  // SEC-2: count_active_months SQL 関数（DISTINCT 月で重複排除）
  if (effectiveResult === 'completed') {
    const { rows: monthRows } = await db.query(
      `SELECT count_active_months($1) AS count`,
      [agent_id]
    );
    updates.active_months = monthRows[0]?.count ?? agent.active_months;
  } else {
    updates.active_months = agent.active_months;
  }

  // avg_sentiment 更新
  let currentSentimentCount = agent.sentiment_count;
  let currentAvgSentiment = agent.avg_sentiment;

  if (effectiveResult === 'completed' && sentiment != null) {
    currentSentimentCount += 1;
    updates.sentiment_count = currentSentimentCount;

    if (currentSentimentCount <= 10) {
      const { rows: avgRows } = await db.query(
        `SELECT AVG(sentiment_given) AS avg FROM mcp_task_results
         WHERE agent_id = $1 AND result = 'completed' AND sentiment_given IS NOT NULL`,
        [agent_id]
      );
      currentAvgSentiment = avgRows[0]?.avg ?? currentAvgSentiment;
    } else {
      currentAvgSentiment = 0.8 * currentAvgSentiment + 0.2 * sentiment;
    }
    updates.avg_sentiment = currentAvgSentiment;
  } else {
    updates.avg_sentiment = currentAvgSentiment;
    updates.sentiment_count = currentSentimentCount;
  }

  // SEC-1: pg カウントクエリで recent_failure_rate を正確に算出
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { rows: failRows } = await db.query(
    `SELECT COUNT(*) AS count FROM mcp_task_results
     WHERE agent_id = $1 AND result = ANY($2) AND resolved_at >= $3`,
    [agent_id, ['failed', 'timeout'], thirtyDaysAgo]
  );
  const { rows: totalRows } = await db.query(
    `SELECT COUNT(*) AS count FROM mcp_task_results
     WHERE agent_id = $1 AND result = ANY($2) AND resolved_at >= $3`,
    [agent_id, ['completed', 'failed', 'timeout'], thirtyDaysAgo]
  );

  const failCount = parseInt(failRows[0]?.count ?? '0', 10);
  const totalCount = parseInt(totalRows[0]?.count ?? '0', 10);
  const recentFailureRate = totalCount > 0 ? failCount / totalCount : 0;

  updates.trust_score = calculateTrustScore({
    completion_count: updates.completion_count,
    smoothed_rate: updates.smoothed_rate,
    active_months: updates.active_months,
    avg_sentiment: updates.avg_sentiment,
    recent_failure_rate: recentFailureRate,
  });

  // DB 更新
  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.query(
    `UPDATE mcp_agents SET ${setClauses} WHERE id = $1`,
    [agent_id, ...Object.values(updates)]
  );

  // Diversity Factor V4: ユニーク取引相手数を更新（シビル攻撃耐性 CVE-T1 対策）
  await db.query(
    `UPDATE mcp_agents SET unique_counterparty_count = get_unique_counterparties(id) WHERE id = $1`,
    [agent_id]
  );

  // Merkle Tree 構築
  const { rows: allAgents } = await db.query(
    `SELECT wallet_address, trust_score FROM mcp_agents ORDER BY wallet_address`
  );
  const agentData = allAgents
    .filter((a) => a.wallet_address)
    .map((a) => ({ wallet: a.wallet_address, trustScore: a.trust_score ?? 0 }));
  const { root: merkleRoot } = buildMerkleTree(agentData);

  // オンチェーン calldata 生成
  let onchain = null;
  if (process.env.SBT_CONTRACT_ADDRESS && agent.wallet_address) {
    try {
      const { hasSbt, tokenId } = await getSbtTokenId(agent.wallet_address);
      if (!hasSbt) {
        onchain = {
          action: 'mint',
          calldata: buildMintCalldata(agent.wallet_address, updates.trust_score),
          merkleRoot,
          note: 'SBTが未発行のため mint を実行してください',
        };
      } else {
        onchain = {
          action: 'updateTrustScore',
          tokenId,
          calldata: buildUpdateTrustScoreCalldata(tokenId, merkleRoot),
          merkleRoot,
          note: '秘密鍵で署名して送信してください（MCP は署名しません）',
        };
      }
    } catch (err) {
      onchain = { error: err.message, merkleRoot };
    }
  } else {
    onchain = { merkleRoot, note: 'SBT_CONTRACT_ADDRESS 未設定のため calldata は生成されていません' };
  }

  return {
    trust_score: updates.trust_score,
    completion_count: updates.completion_count,
    total_task_count: updates.total_task_count,
    smoothed_rate: Math.round(updates.smoothed_rate * 1000) / 1000,
    active_months: updates.active_months,
    avg_sentiment: Math.round(updates.avg_sentiment * 1000) / 1000,
    recent_failure_rate: Math.round(recentFailureRate * 1000) / 1000,
    onchain,
  };
}
