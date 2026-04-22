/**
 * tests/integration/hardhat-helpers.js
 *
 * Hardhat local ノードに接続して MCP calldata を実際にブロードキャストするユーティリティ。
 *
 * 使用前提:
 *   1. Hardhat ノードが起動済み: cd contracts && npx hardhat node
 *   2. MockJPYC + BountyEscrow が Hardhat にデプロイ済み
 *      (contracts/test/integration/fullFlow.test.js が先行デプロイする想定)
 *
 * smart-contract-engineer の fullFlow.test.js 完成後、本ファイルを import して
 * MCP calldata → Hardhat broadcast → receipt 検証を行う。
 */

import { ethers } from 'ethers';

// Hardhat local デフォルトエンドポイント
const HARDHAT_RPC = process.env.HARDHAT_RPC_URL || 'http://127.0.0.1:8545';

// Hardhat default accounts (deterministic private keys)
const HARDHAT_ACCOUNTS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // account[0] = admin/deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // account[1] = client
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // account[2] = worker
];

/**
 * Hardhat local provider を取得する
 */
export function getHardhatProvider() {
  return new ethers.JsonRpcProvider(HARDHAT_RPC);
}

/**
 * Hardhat アカウントの signer を返す
 * @param {number} index - 0=admin, 1=client, 2=worker
 */
export function getHardhatSigner(index = 0) {
  const provider = getHardhatProvider();
  return new ethers.Wallet(HARDHAT_ACCOUNTS[index], provider);
}

/**
 * MCP tool が返した tx_instruction を Hardhat local に送信し receipt を返す
 * @param {object} txInstruction - { to, data, gasLimit, ... }
 * @param {ethers.Signer} signer
 */
export async function broadcastInstruction(txInstruction, signer) {
  const tx = await signer.sendTransaction({
    to: txInstruction.to,
    data: txInstruction.data,
    gasLimit: txInstruction.gasLimit ? BigInt(txInstruction.gasLimit) : 500_000n,
  });
  return tx.wait();
}

/**
 * MockJPYC の approve を送信する (openBounty の前提条件)
 * @param {object} approveInstruction - openBounty result.instructions[0].tx_instruction
 * @param {ethers.Signer} clientSigner
 */
export async function broadcastApprove(approveInstruction, clientSigner) {
  return broadcastInstruction(approveInstruction, clientSigner);
}

/**
 * EIP-3009 transferWithAuthorization 用の署名を生成する
 * (lib/eip3009.js の buildTransferWithAuthorizationTypedData と連携)
 * @param {object} typedData - EIP-712 typed data object
 * @param {ethers.Signer} signer
 */
export async function signEip712(typedData, signer) {
  const { domain, types, message } = typedData;
  // ethers v6: signTypedData
  const signature = await signer.signTypedData(domain, types, message);
  const { v, r, s } = ethers.Signature.from(signature);
  return { v, r, s, signature };
}

/**
 * Hardhat ノードが起動中かどうかを確認する
 * smart-contract-engineer の fullFlow.test.js 連携前チェック用
 */
export async function isHardhatNodeRunning() {
  try {
    const provider = getHardhatProvider();
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

/**
 * コントラクトのイベントログからフィールドを取得するユーティリティ
 * @param {ethers.TransactionReceipt} receipt
 * @param {ethers.Interface} iface - コントラクト ABI から生成した Interface
 * @param {string} eventName
 */
export function parseEventFromReceipt(receipt, iface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
