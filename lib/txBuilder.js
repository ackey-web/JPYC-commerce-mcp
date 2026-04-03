/**
 * トランザクション指示生成モジュール（ノンカストディアル）
 *
 * MCPサーバーは署名しない。エージェントに「何をどう呼ぶか」を指示するだけ。
 * エージェントが自分の秘密鍵で署名・送信する。
 */

const JPYC_CONTRACT = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const CHAIN_ID = 137; // Polygon

const ERC20_TRANSFER_FROM_SELECTOR = '0x23b872dd'; // transferFrom(address,address,uint256)

/**
 * uint256 を32バイトhexにパディング
 */
function toUint256Hex(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

/**
 * address を32バイトhexにパディング
 */
function toAddressHex(addr) {
  return addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

/**
 * JPYC金額をwei単位のBigInt文字列に変換
 */
function jpycToWei(amount) {
  return (BigInt(amount) * BigInt(10 ** 18)).toString();
}

/**
 * ERC20 transferFrom の calldata を生成
 *
 * @param {string} from - 送金元アドレス
 * @param {string} to - 送金先アドレス
 * @param {number} amountJpyc - JPYC金額（整数、wei変換前）
 * @returns {Object} トランザクション指示
 */
export function buildTransferFromInstruction(from, to, amountJpyc) {
  const amountWei = jpycToWei(amountJpyc);

  // calldata = selector + from(32bytes) + to(32bytes) + amount(32bytes)
  const calldata = ERC20_TRANSFER_FROM_SELECTOR +
    toAddressHex(from) +
    toAddressHex(to) +
    toUint256Hex(amountWei);

  return {
    chain: 'polygon',
    chainId: CHAIN_ID,
    to: JPYC_CONTRACT,
    value: '0',
    data: calldata,
    description: `JPYC transferFrom: ${from} → ${to}, ${amountJpyc} JPYC`,
    // エージェントが自分で検証できるようにデコード情報も提供
    decoded: {
      contract: JPYC_CONTRACT,
      function: 'transferFrom(address,address,uint256)',
      args: {
        from,
        to,
        amount: amountWei,
        amountHuman: `${amountJpyc} JPYC`,
      },
    },
    // エージェントへのガス推奨値
    gasEstimate: {
      gasLimit: '100000',
      maxFeePerGas: '200000000000',      // 200 gwei
      maxPriorityFeePerGas: '50000000000', // 50 gwei
    },
  };
}

/**
 * approve の calldata を生成（エスクロー前に必要な場合）
 */
export function buildApproveInstruction(spender, amountJpyc) {
  const amountWei = jpycToWei(amountJpyc);
  const APPROVE_SELECTOR = '0x095ea7b3'; // approve(address,uint256)

  const calldata = APPROVE_SELECTOR +
    toAddressHex(spender) +
    toUint256Hex(amountWei);

  return {
    chain: 'polygon',
    chainId: CHAIN_ID,
    to: JPYC_CONTRACT,
    value: '0',
    data: calldata,
    description: `JPYC approve: ${spender} for ${amountJpyc} JPYC`,
    decoded: {
      contract: JPYC_CONTRACT,
      function: 'approve(address,uint256)',
      args: {
        spender,
        amount: amountWei,
        amountHuman: `${amountJpyc} JPYC`,
      },
    },
    gasEstimate: {
      gasLimit: '60000',
      maxFeePerGas: '200000000000',
      maxPriorityFeePerGas: '50000000000',
    },
  };
}
