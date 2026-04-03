/**
 * Merkle Root コミットスクリプト
 *
 * 全エージェントの trust_score から Merkle Tree を構築し、
 * TrustScoreRegistry コントラクトに Root をコミットする
 *
 * 実行: node scripts/commitMerkleRoot.js
 * 定期実行: cron で毎日1回など
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });

import { getSupabase } from '../lib/supabase.js';
import { buildMerkleTree } from '../lib/merkle.js';

const REGISTRY_ABI = [
  'function commitRoot(bytes32 merkleRoot, uint256 agentCount) external',
  'function currentEpoch() view returns (uint256)',
  'function currentRoot() view returns (bytes32)',
];

async function main() {
  const registryAddress = process.env.TRUST_SCORE_REGISTRY_ADDRESS;
  const signerKey = process.env.PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY;
  const rpcUrl = process.env.VITE_ALCHEMY_RPC_URL || process.env.POLYGON_RPC_URL;

  if (!registryAddress) {
    console.error('TRUST_SCORE_REGISTRY_ADDRESS が未設定です');
    process.exit(1);
  }
  if (!signerKey) {
    console.error('PRIVATE_KEY または RELAYER_PRIVATE_KEY が未設定です');
    process.exit(1);
  }

  const supabase = getSupabase();

  // 全エージェントのスコアを取得
  const { data: agents, error } = await supabase
    .from('mcp_agents')
    .select('wallet_address, trust_score')
    .order('wallet_address');

  if (error) {
    console.error('エージェント取得失敗:', error.message);
    process.exit(1);
  }

  if (!agents || agents.length === 0) {
    console.log('エージェントが0件のためスキップ');
    return;
  }

  // Merkle Tree 構築
  const agentData = agents.map((a) => ({
    wallet: a.wallet_address,
    trustScore: a.trust_score,
  }));

  const { root } = buildMerkleTree(agentData);

  console.log(`=== Merkle Root コミット ===`);
  console.log(`エージェント数: ${agents.length}`);
  console.log(`Merkle Root: ${root}`);

  // オンチェーンにコミット
  const { ethers } = await import('ethers');
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(signerKey, provider);
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, wallet);

  const currentEpoch = await registry.currentEpoch();
  console.log(`現在のepoch: ${currentEpoch.toString()}`);

  const tx = await registry.commitRoot(root, agents.length, {
    maxFeePerGas: ethers.utils.parseUnits('200', 'gwei'),
    maxPriorityFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
    gasLimit: 300000,
  });

  console.log(`TX送信: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`完了！ Block: ${receipt.blockNumber}`);

  const newEpoch = await registry.currentEpoch();
  console.log(`新しいepoch: ${newEpoch.toString()}`);

  // Supabaseにスナップショット記録
  await supabase.from('mcp_trust_snapshots').insert({
    epoch: newEpoch.toNumber(),
    merkle_root: root,
    agent_count: agents.length,
    tx_hash: tx.hash,
    committed_at: new Date().toISOString(),
  });

  console.log('スナップショット記録完了');
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
