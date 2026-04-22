/**
 * SBT クライアント（ノンカストディアル）
 *
 * ethers.js v6 経由でオンチェーンを read-only 参照し、
 * mint/update の calldata を返す。MCPサーバー自身は秘密鍵を保有しない。
 *
 * 環境変数:
 *   POLYGON_RPC_URL          - Amoy or Mainnet の RPC URL
 *   SBT_CONTRACT_ADDRESS     - TrustSBT コントラクトアドレス
 *   CHAIN_ID                 - チェーンID（デフォルト 80002 = Amoy testnet）
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// コントラクトと同梱の ABI を使用
let _abi = null;
function getAbi() {
  if (_abi) return _abi;
  try {
    const abiPath = join(__dirname, '../contracts/abi/TrustSBT.json');
    _abi = require(abiPath).abi;
  } catch {
    // contracts/ ディレクトリがない環境向けのインライン最小 ABI
    _abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function ownerOf(uint256 tokenId) view returns (address)',
      'function tokenURI(uint256 tokenId) view returns (string)',
      'function tokenIdOf(address wallet) view returns (uint256)',
      'function locked(uint256 tokenId) view returns (bool)',
      'function merkleRootOf(address wallet) view returns (bytes32)',
      'function trustMerkleRoot(uint256 tokenId) view returns (bytes32)',
      'function mint(address to, string metadataURI) external returns (uint256)',
      'function updateTrustScore(uint256 tokenId, bytes32 merkleRoot) external',
    ];
  }
  return _abi;
}

let _provider = null;
let _contract = null;

function getConfig() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const contractAddress = process.env.SBT_CONTRACT_ADDRESS;
  const chainId = parseInt(process.env.CHAIN_ID || '80002', 10);
  return { rpcUrl, contractAddress, chainId };
}

function getProvider() {
  if (_provider) return _provider;
  const { rpcUrl } = getConfig();
  if (!rpcUrl) throw new Error('POLYGON_RPC_URL が未設定です');
  _provider = new ethers.JsonRpcProvider(rpcUrl);
  return _provider;
}

function getContract() {
  if (_contract) return _contract;
  const { contractAddress } = getConfig();
  if (!contractAddress) throw new Error('SBT_CONTRACT_ADDRESS が未設定です');
  _contract = new ethers.Contract(contractAddress, getAbi(), getProvider());
  return _contract;
}

// ---- Read 関数 ----

/**
 * ウォレットが SBT を保有しているか確認し、tokenId を返す
 * @param {string} ownerAddress
 * @returns {Promise<{ hasSbt: boolean, tokenId: string|null, error?: string }>}
 */
export async function getSbtTokenId(ownerAddress) {
  try {
    const contract = getContract();
    const balance = await contract.balanceOf(ownerAddress);
    if (balance === 0n) return { hasSbt: false, tokenId: null };
    const tokenId = await contract.tokenIdOf(ownerAddress);
    return { hasSbt: true, tokenId: tokenId.toString() };
  } catch (err) {
    if (err.message.includes('SBT_CONTRACT_ADDRESS') || err.message.includes('POLYGON_RPC_URL')) {
      throw err;
    }
    return { hasSbt: false, tokenId: null, error: err.message };
  }
}

/**
 * SBT のロック状態を取得（ERC-5192）
 * @param {string|bigint} tokenId
 * @returns {Promise<boolean>}
 */
export async function isSbtLocked(tokenId) {
  const contract = getContract();
  return contract.locked(BigInt(tokenId));
}

/**
 * オンチェーンに記録されている Merkle Root をウォレットアドレスで取得
 * @param {string} walletAddress
 * @returns {Promise<string>} bytes32 hex string
 */
export async function getOnChainMerkleRoot(walletAddress) {
  const contract = getContract();
  const root = await contract.merkleRootOf(walletAddress);
  return root;
}

/**
 * tokenURI を取得
 * @param {string|bigint} tokenId
 * @returns {Promise<string>}
 */
export async function getSbtTokenURI(tokenId) {
  const contract = getContract();
  return contract.tokenURI(BigInt(tokenId));
}

// ---- ランク計算 ----

/**
 * trust_score（0.0〜1.0）からランクと自動承認上限を算出
 * tokenomics-advisor 設計準拠（docs/sbt-metadata-spec.md）
 *
 * @param {number} trustScore - 0.0〜1.0
 * @returns {{ rank: string, autoApproveLimit: number|null, scoreInt: number }}
 */
export function computeRank(trustScore) {
  const scoreInt = Math.round(trustScore * 100);
  if (scoreInt >= 100) return { rank: 'Platinum', autoApproveLimit: null,  scoreInt };
  if (scoreInt >= 60)  return { rank: 'Gold',     autoApproveLimit: 2000,  scoreInt };
  if (scoreInt >= 30)  return { rank: 'Silver',   autoApproveLimit: 500,   scoreInt };
  return                      { rank: 'Bronze',   autoApproveLimit: 100,   scoreInt };
}

/**
 * mint 用メタデータ URI を生成（Phase 0: data URI インライン）
 *
 * @param {number} trustScore - 0.0〜1.0
 * @param {number} completionCount
 * @param {string} issuedAt - ISO 8601 文字列
 * @returns {string} data URI
 */
export function buildMetadataURI(trustScore, completionCount, issuedAt) {
  const { rank, autoApproveLimit, scoreInt } = computeRank(trustScore);
  const issuedTimestamp = Math.floor(new Date(issuedAt).getTime() / 1000);

  const attributes = [
    { trait_type: 'trust_score',        value: scoreInt,        display_type: 'number' },
    { trait_type: 'completion_count',   value: completionCount, display_type: 'number' },
    { trait_type: 'rank',               value: rank },
    { trait_type: 'issued_at',          value: issuedTimestamp, display_type: 'date' },
  ];

  if (autoApproveLimit !== null) {
    attributes.splice(3, 0, {
      trait_type: 'auto_approve_limit',
      value: autoApproveLimit,
      display_type: 'number',
    });
  }

  const metadata = {
    name: 'JPYC Commerce Trust SBT',
    description: 'Soul Bound Token representing verified agent trust in the JPYC Commerce MCP ecosystem.',
    attributes,
  };

  return `data:application/json,${JSON.stringify(metadata)}`;
}

// ---- Calldata ビルダー ----

/**
 * mint calldata を生成（ノンカストディアル）
 *
 * @param {string} toAddress - mint 先ウォレット
 * @param {string} metadataURI - IPFS URI 等のメタデータ URI（例: "ipfs://..."）
 * @returns {Object} トランザクション指示
 */
export function buildMintCalldata(toAddress, metadataURI) {
  const { contractAddress, chainId } = getConfig();
  if (!contractAddress) throw new Error('SBT_CONTRACT_ADDRESS が未設定です');

  const iface = new ethers.Interface(getAbi());
  const data = iface.encodeFunctionData('mint', [toAddress, metadataURI]);

  return {
    chain: chainId === 80002 ? 'polygon-amoy' : 'polygon',
    chainId,
    to: contractAddress,
    value: '0',
    data,
    description: `SBT mint: to=${toAddress}, metadataURI=${metadataURI}`,
    decoded: {
      contract: contractAddress,
      function: 'mint(address,string)',
      args: { to: toAddress, metadataURI },
    },
    gasEstimate: {
      gasLimit: '200000',
      maxFeePerGas: process.env.GAS_MAX_FEE_PER_GAS || '50000000000',
      maxPriorityFeePerGas: process.env.GAS_MAX_PRIORITY_FEE_PER_GAS || '10000000000',
    },
  };
}

/**
 * updateTrustScore calldata を生成（ノンカストディアル）
 *
 * @param {string|number} tokenId
 * @param {string} merkleRoot - 0x プレフィクス付き bytes32
 * @returns {Object} トランザクション指示
 */
export function buildUpdateTrustScoreCalldata(tokenId, merkleRoot) {
  const { contractAddress, chainId } = getConfig();
  if (!contractAddress) throw new Error('SBT_CONTRACT_ADDRESS が未設定です');

  const iface = new ethers.Interface(getAbi());
  const data = iface.encodeFunctionData('updateTrustScore', [
    BigInt(tokenId),
    merkleRoot,
  ]);

  return {
    chain: chainId === 80002 ? 'polygon-amoy' : 'polygon',
    chainId,
    to: contractAddress,
    value: '0',
    data,
    description: `SBT updateTrustScore: tokenId=${tokenId}, merkleRoot=${merkleRoot}`,
    decoded: {
      contract: contractAddress,
      function: 'updateTrustScore(uint256,bytes32)',
      args: { tokenId: tokenId.toString(), merkleRoot },
    },
    gasEstimate: {
      gasLimit: '150000',
      maxFeePerGas: process.env.GAS_MAX_FEE_PER_GAS || '50000000000',
      maxPriorityFeePerGas: process.env.GAS_MAX_PRIORITY_FEE_PER_GAS || '10000000000',
    },
  };
}
