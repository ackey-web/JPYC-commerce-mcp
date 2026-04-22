/**
 * Tool 1 (v2): get_sbt_profile
 * エージェントのプロフィール（信頼スコア・実績・評価）を取得する
 * オンチェーン連携: locked 状態・Merkle Root・tokenURI・ランク情報も返す
 */
import { db } from '../lib/db.js';
import {
  getSbtTokenId,
  isSbtLocked,
  getOnChainMerkleRoot,
  getSbtTokenURI,
  computeRank,
} from '../lib/sbtClient.js';

export default async function handler({ wallet_address }) {
  const normalized = wallet_address.toLowerCase();

  // オフチェーン DB 参照
  const { rows } = await db.query(
    `SELECT id, trust_score, completion_count, total_task_count, smoothed_rate,
            active_months, avg_sentiment, sentiment_count,
            seller_score, seller_completion_count, buyer_score, buyer_completion_count,
            unique_counterparty_count
     FROM mcp_agents
     WHERE wallet_address = $1`,
    [normalized]
  );

  let offchain = rows[0] ?? null;

  if (!offchain) {
    const { rows: inserted } = await db.query(
      `INSERT INTO mcp_agents
         (wallet_address, trust_score, completion_count, total_task_count,
          smoothed_rate, active_months, avg_sentiment, sentiment_count)
       VALUES ($1, 0.0, 0, 0, 0.5, 0, 0.5, 0)
       RETURNING id, trust_score, completion_count, total_task_count, smoothed_rate,
                 active_months, avg_sentiment, sentiment_count,
                 seller_score, seller_completion_count, buyer_score, buyer_completion_count,
                 unique_counterparty_count`,
      [normalized]
    );

    if (!inserted[0]) {
      throw new Error(`mcp_agents 新規作成失敗: wallet_address=${normalized}`);
    }
    offchain = inserted[0];
  }

  // オフチェーンのランク情報を付与
  const { rank, autoApproveLimit, scoreInt } = computeRank(offchain.trust_score ?? 0);

  // オンチェーン参照（SBT_CONTRACT_ADDRESS が設定されている場合のみ）
  let onchain = null;

  if (process.env.SBT_CONTRACT_ADDRESS) {
    try {
      const { hasSbt, tokenId } = await getSbtTokenId(normalized);

      if (hasSbt && tokenId != null) {
        const [locked, onChainMerkleRoot, tokenURI] = await Promise.all([
          isSbtLocked(tokenId),
          getOnChainMerkleRoot(normalized),
          getSbtTokenURI(tokenId).catch(() => null),
        ]);
        onchain = { hasSbt: true, tokenId, locked, onChainMerkleRoot, tokenURI };
      } else {
        onchain = { hasSbt: false };
      }
    } catch (err) {
      onchain = { error: err.message };
    }
  }

  return {
    ...offchain,
    rank,
    auto_approve_limit: autoApproveLimit,
    trust_score_int: scoreInt,
    onchain,
  };
}
