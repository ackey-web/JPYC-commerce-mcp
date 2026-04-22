/**
 * Tool 7: verify_trust_score
 * エージェントの信頼スコアをオンチェーンMerkle Rootで検証する
 */
import { db } from '../lib/db.js';
import { buildMerkleTree, getMerkleProof, verifyProof } from '../lib/merkle.js';

export default async function handler({ wallet_address }) {
  const normalized = wallet_address.toLowerCase();

  const { rows } = await db.query(
    `SELECT trust_score, updated_at FROM mcp_agents WHERE wallet_address = $1`,
    [normalized]
  );
  const agent = rows[0];
  if (!agent) throw new Error(`エージェント ${wallet_address} が見つかりません`);

  const { rows: snapRows } = await db.query(
    `SELECT * FROM mcp_merkle_commits ORDER BY committed_at DESC LIMIT 1`
  );
  const snapshot = snapRows[0] ?? null;

  if (!snapshot) {
    return {
      wallet_address: normalized, trust_score: agent.trust_score,
      verification: 'no_snapshot', message: 'オンチェーンスナップショットがまだ存在しません',
    };
  }

  const { rows: allAgentRows } = await db.query(
    `SELECT wallet_address, trust_score FROM mcp_agents ORDER BY wallet_address`
  );
  const agents = allAgentRows.map((a) => ({ wallet: a.wallet_address, trustScore: a.trust_score }));
  const { root, tree } = buildMerkleTree(agents);

  const agentIndex = agents.findIndex((a) => a.wallet === normalized);
  if (agentIndex === -1) {
    return {
      wallet_address: normalized, trust_score: agent.trust_score,
      verification: 'not_in_tree', message: 'エージェントがMerkle Treeに含まれていません',
    };
  }

  const proof = getMerkleProof(tree, agentIndex);
  const offchainValid = verifyProof(snapshot.merkle_root, normalized, agent.trust_score, proof);
  const scoreUpdatedAfterSnapshot = new Date(agent.updated_at) > new Date(snapshot.committed_at);

  return {
    wallet_address: normalized, trust_score: agent.trust_score,
    verification: offchainValid ? 'verified' : 'unverified',
    epoch: snapshot.committed_at, on_chain_root: snapshot.merkle_root, computed_root: root,
    roots_match: snapshot.merkle_root === root, proof,
    score_updated_after_snapshot: scoreUpdatedAfterSnapshot,
    message: offchainValid
      ? `trust_score ${agent.trust_score} はオンチェーンMerkle Rootで検証済み`
      : scoreUpdatedAfterSnapshot
        ? 'スコアが最新スナップショット以降に更新されています（次回コミットで反映）'
        : '検証失敗: スコアがオンチェーン記録と一致しません（改ざんの可能性）',
  };
}
