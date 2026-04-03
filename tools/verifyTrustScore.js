/**
 * Tool 7: verify_trust_score
 * エージェントの信頼スコアをオンチェーンMerkle Rootで検証する
 *
 * フロー:
 * 1. Supabaseからエージェントのスコアとキャッシュ済みProofを取得
 * 2. オンチェーンのTrustScoreRegistry.verifyScore() で検証
 * 3. 結果を返す（verified / unverified / no_snapshot）
 */
import { supabase } from '../lib/supabase.js';
import { buildMerkleTree, getMerkleProof, verifyProof } from '../lib/merkle.js';

export default async function handler({ wallet_address }) {
  const normalized = wallet_address.toLowerCase();

  // エージェントのスコアを取得
  const { data: agent, error } = await supabase
    .from('mcp_agents')
    .select('trust_score, updated_at')
    .eq('wallet_address', normalized)
    .single();

  if (error || !agent) {
    throw new Error(`エージェント ${wallet_address} が見つかりません`);
  }

  // 最新のスナップショットを取得
  const { data: snapshot } = await supabase
    .from('mcp_trust_snapshots')
    .select('*')
    .order('epoch', { ascending: false })
    .limit(1)
    .single();

  if (!snapshot) {
    return {
      wallet_address: normalized,
      trust_score: agent.trust_score,
      verification: 'no_snapshot',
      message: 'オンチェーンスナップショットがまだ存在しません',
    };
  }

  // 全エージェントを取得してMerkle Treeを再構築
  const { data: allAgents } = await supabase
    .from('mcp_agents')
    .select('wallet_address, trust_score')
    .order('wallet_address');

  const agents = (allAgents || []).map((a) => ({
    wallet: a.wallet_address,
    trustScore: a.trust_score,
  }));

  const { root, tree } = buildMerkleTree(agents);

  // 対象エージェントのインデックスを特定
  const agentIndex = agents.findIndex((a) => a.wallet === normalized);
  if (agentIndex === -1) {
    return {
      wallet_address: normalized,
      trust_score: agent.trust_score,
      verification: 'not_in_tree',
      message: 'エージェントがMerkle Treeに含まれていません（スナップショット後に登録された可能性）',
    };
  }

  // Proof生成
  const proof = getMerkleProof(tree, agentIndex);

  // オフチェーン検証（オンチェーンのrootと比較）
  const offchainValid = verifyProof(snapshot.merkle_root, normalized, agent.trust_score, proof);

  // スコアが最後のスナップショット以降に更新されたか
  const scoreUpdatedAfterSnapshot = new Date(agent.updated_at) > new Date(snapshot.committed_at);

  return {
    wallet_address: normalized,
    trust_score: agent.trust_score,
    verification: offchainValid ? 'verified' : 'unverified',
    epoch: snapshot.epoch,
    on_chain_root: snapshot.merkle_root,
    computed_root: root,
    roots_match: snapshot.merkle_root === root,
    proof,
    score_updated_after_snapshot: scoreUpdatedAfterSnapshot,
    message: offchainValid
      ? `trust_score ${agent.trust_score} はepoch ${snapshot.epoch} のオンチェーンMerkle Rootで検証済み`
      : scoreUpdatedAfterSnapshot
        ? `スコアが最新スナップショット以降に更新されています（次回コミットで反映）`
        : `検証失敗: スコアがオンチェーン記録と一致しません`,
  };
}
