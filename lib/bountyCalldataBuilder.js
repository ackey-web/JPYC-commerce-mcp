/**
 * BountyEscrow calldata ビルダー（ノンカストディアル）
 *
 * MCP は calldata を返すだけ。署名・送信はクライアント側の責任。
 * ABI エンコーディングは手動（ethers.js 依存なし）。
 *
 * セレクター計算根拠（ethers.js ethers.id() で確認済み）:
 *   openBounty(bytes32,uint128)               → 0xdf6814f6
 *   submitBid(bytes32,uint128,bytes32)         → 0xce677693
 *   acceptBid(bytes32,uint64)                 → 0x09dfd4b7
 *   confirmDelivery(bytes32)                  → 0x74950ffd
 *   submitDeliverable(bytes32,bytes32)         → 0xd46600aa
 *   depositWithAuthorization(bytes32,uint128,uint256,uint256,bytes32,uint8,bytes32,bytes32)
 *                                             → 0x... (EIP-3009: Task #36 で実装)
 */

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '80002', 10); // Amoy testnet
const CHAIN_NAME = CHAIN_ID === 137 ? 'polygon' : 'polygon-amoy';

const BOUNTY_ESCROW_ADDRESS = process.env.BOUNTY_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000';

// --- function selectors (keccak256 先頭4バイト、0x なし 8hex、BountyEscrow.sol のシグネチャと一致) ---
const SEL = {
  openBounty:       'df6814f6', // openBounty(bytes32,uint128)
  submitBid:        'ce677693', // submitBid(bytes32,uint128,bytes32)
  acceptBid:        '09dfd4b7', // acceptBid(bytes32,uint64)
  confirmDelivery:  '74950ffd', // confirmDelivery(bytes32)
  submitDeliverable:'d46600aa', // submitDeliverable(bytes32,bytes32)
};

/**
 * ABI uint256 エンコード（32バイト左パディング）
 * uint64 / uint128 も ABI レイヤーでは 32 バイトにパディングされる。
 */
function toUint256(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

/**
 * ABI bytes32 エンコード（hex を 32 バイトに正規化）
 * bytes32 は右パディング（左詰め）ではなく左詰めそのまま。
 * ただし jobKey は keccak256 由来の 32 バイト固定値なので右パディング不要。
 */
function toBytes32(hex) {
  const clean = hex.replace(/^0x/, '').padEnd(64, '0').slice(0, 64);
  return clean;
}

function gasEstimate(limit) {
  return {
    gasLimit: String(limit),
    maxFeePerGas: process.env.MAX_FEE_PER_GAS || '200000000000',
    maxPriorityFeePerGas: process.env.MAX_PRIORITY_FEE_PER_GAS || '50000000000',
  };
}

function instruction({ selector, args, description, decodedArgs }) {
  const data = '0x' + selector + args.join('');
  return {
    chain: CHAIN_NAME,
    chainId: CHAIN_ID,
    to: BOUNTY_ESCROW_ADDRESS,
    value: '0',
    data,
    description,
    decoded: {
      contract: BOUNTY_ESCROW_ADDRESS,
      args: decodedArgs,
    },
    gasEstimate: gasEstimate(200000),
  };
}

/**
 * openBounty(bytes32 jobKey, uint128 amount)
 * 事前に JPYC.approve(BOUNTY_ESCROW_ADDRESS, amount) が必要。
 * amount は JPYC 最小単位（1 JPYC = 1e18）で渡すこと。
 *
 * @param {string} jobKey     0x プレフィックス付き 32 バイト hex
 * @param {number} amountJpyc 人間可読な JPYC 額（例: 1000 → 1000 JPYC）
 */
export function buildOpenBountyInstruction(jobKey, amountJpyc) {
  const amountWei = (BigInt(amountJpyc) * BigInt('1000000000000000000')).toString();
  return instruction({
    selector: SEL.openBounty,
    args: [
      toBytes32(jobKey),
      toUint256(amountWei),
    ],
    description: `BountyEscrow.openBounty: jobKey=${jobKey}, ${amountJpyc} JPYC`,
    decodedArgs: { jobKey, amountWei, amountHuman: `${amountJpyc} JPYC` },
  });
}

/**
 * submitBid(bytes32 jobKey, uint128 bidAmount, bytes32 proposalHash)
 *
 * @param {string} jobKey        バウンティの jobKey（bytes32 hex）
 * @param {number} bidAmountJpyc 入札額（JPYC 単位）
 * @param {string} proposalHash  提案内容ハッシュ（bytes32 hex）
 */
export function buildSubmitBidInstruction(jobKey, bidAmountJpyc, proposalHash) {
  const amountWei = (BigInt(bidAmountJpyc) * BigInt(10 ** 18)).toString();
  return instruction({
    selector: SEL.submitBid,
    args: [
      toBytes32(jobKey),
      toUint256(amountWei),
      toBytes32(proposalHash || '0x' + '0'.repeat(64)),
    ],
    description: `BountyEscrow.submitBid: jobKey=${jobKey}, ${bidAmountJpyc} JPYC`,
    decodedArgs: { jobKey, bidAmountWei: amountWei, bidAmountHuman: `${bidAmountJpyc} JPYC`, proposalHash },
  });
}

/**
 * acceptBid(bytes32 jobKey, uint64 bidId)
 * クライアントが入札を受諾し、ワーカーを ASSIGNED にする。
 *
 * @param {string} jobKey      バウンティの jobKey（bytes32 hex）
 * @param {number|bigint} bidId コントラクト内部の bid ID（uint64）
 */
export function buildAcceptBidInstruction(jobKey, bidId) {
  return instruction({
    selector: SEL.acceptBid,
    args: [
      toBytes32(jobKey),
      toUint256(bidId),
    ],
    description: `BountyEscrow.acceptBid: jobKey=${jobKey}, bidId=${bidId}`,
    decodedArgs: { jobKey, bidId: String(bidId) },
  });
}

/**
 * confirmDelivery(bytes32 jobKey)
 * クライアントが成果物を確認し、JPYC をワーカーに解放する。
 *
 * @param {string} jobKey バウンティの jobKey（bytes32 hex）
 */
export function buildConfirmDeliveryInstruction(jobKey) {
  return instruction({
    selector: SEL.confirmDelivery,
    args: [toBytes32(jobKey)],
    description: `BountyEscrow.confirmDelivery: jobKey=${jobKey}`,
    decodedArgs: { jobKey },
  });
}

/**
 * submitDeliverable(bytes32 jobKey, bytes32 deliverableHash)
 * ワーカーが成果物を提出する（ASSIGNED → SUBMITTED）。
 *
 * @param {string} jobKey          バウンティの jobKey（bytes32 hex）
 * @param {string} deliverableHash 成果物ハッシュ（IPFS CID 等、bytes32 hex）
 */
export function buildSubmitDeliverableInstruction(jobKey, deliverableHash) {
  return instruction({
    selector: SEL.submitDeliverable,
    args: [
      toBytes32(jobKey),
      toBytes32(deliverableHash || '0x' + '0'.repeat(64)),
    ],
    description: `BountyEscrow.submitDeliverable: jobKey=${jobKey}`,
    decodedArgs: { jobKey, deliverableHash },
  });
}
