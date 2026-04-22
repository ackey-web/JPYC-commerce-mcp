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

import { db } from '../lib/db.js';
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

  // 全エージェントのスコアを取得
  const { rows: agents } = await db.query(
    `SELECT wallet_address, trust_score FROM mcp_agents ORDER BY wallet_address`
  );

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

  // スナップショット記録（mcp_trust_snapshots テーブルがあれば記録）
  // NOTE: 初期スキーマには未定義。backend-engineer にテーブル追加依頼後、
  //       本 INSERT が実効となる。未定義時は relation エラーをキャッチして
  //       オンチェーンコミット成功をログ出力し正常終了する。
  try {
    await db.query(
      `INSERT INTO mcp_trust_snapshots (epoch, merkle_root, agent_count, tx_hash, committed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [newEpoch.toNumber(), root, agents.length, tx.hash]
    );
    console.log('スナップショット記録完了');
  } catch (err) {
    if (err && err.code === '42P01') {
      console.warn('mcp_trust_snapshots テーブル未定義のためスナップショット記録をスキップ');
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
