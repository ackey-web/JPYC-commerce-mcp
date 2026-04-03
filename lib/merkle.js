/**
 * Merkle Tree 構築・Proof生成・検証モジュール
 *
 * エージェントの (wallet_address, trust_score) ペアからMerkle Treeを構築し、
 * オンチェーンのTrustScoreRegistryと照合可能なProofを生成する
 */
import { createHash } from 'crypto';

/**
 * keccak256 ハッシュ（ethers互換）
 * Solidityの abi.encodePacked(address, uint256) と同じエンコーディング
 */
function keccak256(data) {
  return createHash('sha3-256').update(data).digest();
}

/**
 * エージェントデータからleafハッシュを生成
 * Solidity側: keccak256(abi.encodePacked(wallet, trustScore))
 *
 * @param {string} wallet - ウォレットアドレス (0x...)
 * @param {number} trustScore - trust_score（小数第2位まで）
 * @returns {Buffer} 32バイトのハッシュ
 */
export function computeLeaf(wallet, trustScore) {
  // trust_score を 100倍して整数化（Solidity側と合わせる）
  const scoreInt = Math.round(trustScore * 100);

  // abi.encodePacked(address, uint256)
  // address = 20 bytes, uint256 = 32 bytes
  const addressBytes = Buffer.from(wallet.replace('0x', '').toLowerCase(), 'hex');
  const scoreBytes = Buffer.alloc(32);
  // BigEndianで格納（Solidityのuint256互換）
  const scoreBigInt = BigInt(scoreInt);
  for (let i = 31; i >= 0; i--) {
    scoreBytes[i] = Number(scoreBigInt >> BigInt((31 - i) * 8) & BigInt(0xff));
  }

  const packed = Buffer.concat([addressBytes, scoreBytes]);
  return keccak256(packed);
}

/**
 * ソート済みペアハッシュ（Solidityの検証ロジックと一致させる）
 */
function hashPair(a, b) {
  if (Buffer.compare(a, b) <= 0) {
    return keccak256(Buffer.concat([a, b]));
  } else {
    return keccak256(Buffer.concat([b, a]));
  }
}

/**
 * Merkle Treeを構築
 *
 * @param {{ wallet: string, trustScore: number }[]} agents
 * @returns {{ root: string, leaves: Buffer[], tree: Buffer[][] }}
 */
export function buildMerkleTree(agents) {
  if (agents.length === 0) {
    return { root: '0x' + '0'.repeat(64), leaves: [], tree: [] };
  }

  // leaf層を構築
  const leaves = agents.map((a) => computeLeaf(a.wallet, a.trustScore));

  // ツリー構築（ボトムアップ）
  const tree = [leaves.slice()]; // layer 0 = leaves
  let currentLayer = leaves.slice();

  while (currentLayer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
      } else {
        // 奇数の場合、自分自身とペア
        nextLayer.push(hashPair(currentLayer[i], currentLayer[i]));
      }
    }
    tree.push(nextLayer);
    currentLayer = nextLayer;
  }

  const root = '0x' + currentLayer[0].toString('hex');
  return { root, leaves, tree };
}

/**
 * 指定インデックスのleafに対するMerkle Proofを生成
 *
 * @param {Buffer[][]} tree - buildMerkleTreeで構築したツリー
 * @param {number} leafIndex - 対象のleafインデックス
 * @returns {string[]} proof（bytes32の配列、0xプレフィクス付き）
 */
export function getMerkleProof(tree, leafIndex) {
  const proof = [];
  let index = leafIndex;

  for (let layer = 0; layer < tree.length - 1; layer++) {
    const currentLayer = tree[layer];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    if (siblingIndex < currentLayer.length) {
      proof.push('0x' + currentLayer[siblingIndex].toString('hex'));
    } else {
      // 奇数ノードの場合、自分自身がsibling
      proof.push('0x' + currentLayer[index].toString('hex'));
    }

    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * オフチェーンでMerkle Proofを検証
 *
 * @param {string} root - Merkle Root (0x...)
 * @param {string} wallet - ウォレットアドレス
 * @param {number} trustScore - trust_score
 * @param {string[]} proof - Merkle Proof配列
 * @returns {boolean}
 */
export function verifyProof(root, wallet, trustScore, proof) {
  let hash = computeLeaf(wallet, trustScore);

  for (const proofElement of proof) {
    const sibling = Buffer.from(proofElement.replace('0x', ''), 'hex');
    hash = hashPair(hash, sibling);
  }

  return '0x' + hash.toString('hex') === root;
}
