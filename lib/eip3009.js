/**
 * EIP-3009 / EIP-712 typed-data ヘルパー（JPYC v2 仕様準拠）
 *
 * JPYC v2 は Centre FiatToken v2.1 fork。
 * domain name = "JPY Coin" / version = "1" / verifyingContract = JPYC コントラクトアドレス
 *
 * 参考: https://github.com/jpy-citizen-labs/jpyc-contracts
 *
 * このモジュールは署名対象の構造化データを組み立てるだけで、
 * 秘密鍵・署名処理は一切行わない（ノンカストディアル原則）。
 */

// JPYC v2 Polygon Mainnet
const JPYC_MAINNET = '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB';

// TRANSFER_WITH_AUTHORIZATION_TYPEHASH
// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267';

/**
 * EIP-712 domain separator の構造体
 *
 * JPYC v2 では salt フィールドなし / chainId あり / verifyingContract あり
 */
const EIP712_DOMAIN_TYPE = [
  { name: 'name',               type: 'string'  },
  { name: 'version',            type: 'string'  },
  { name: 'chainId',            type: 'uint256' },
  { name: 'verifyingContract',  type: 'address' },
];

const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: 'from',        type: 'address' },
  { name: 'to',          type: 'address' },
  { name: 'value',       type: 'uint256' },
  { name: 'validAfter',  type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce',       type: 'bytes32' },
];

/**
 * JPYC v2 の EIP-712 domain を返す
 *
 * @param {object} params
 * @param {number|string} params.chainId         チェーン ID（137 = mainnet, 80002 = Amoy）
 * @param {string}        [params.contractAddress] JPYC コントラクトアドレス（省略時は mainnet）
 * @returns {object} EIP-712 domain object
 */
export function getJpycDomain({ chainId, contractAddress }) {
  return {
    name: 'JPY Coin',
    version: '1',
    chainId: Number(chainId),
    verifyingContract: contractAddress || JPYC_MAINNET,
  };
}

/**
 * transferWithAuthorization の EIP-712 typed data を構築する
 *
 * 返却値を ethers.js v6 の `signer.signTypedData(domain, types, value)` に
 * そのまま渡せる形式で返す。
 *
 * @param {object} params
 * @param {string}        params.from            送金元アドレス（署名者）
 * @param {string}        params.to              送金先アドレス（BountyEscrow 等）
 * @param {string|bigint} params.value           転送額（wei 単位の文字列 or BigInt）
 * @param {number|bigint} params.validAfter      署名有効開始（UNIX秒、0 = 即時有効）
 * @param {number|bigint} params.validBefore     署名有効期限（UNIX秒）
 * @param {string}        params.nonce           bytes32 hex（0x プレフィックス付き）
 * @param {number|string} params.chainId         チェーン ID
 * @param {string}        [params.contractAddress] JPYC コントラクトアドレス
 * @returns {{ domain, types, message, typedDataHash: null }}
 *   domain / types / message: ethers.js signTypedData 用
 *   rawTypedData: EIP-712 完全な typed data（他ライブラリ向け）
 */
export function buildTransferWithAuthorizationTypedData({
  from,
  to,
  value,
  validAfter,
  validBefore,
  nonce,
  chainId,
  contractAddress,
}) {
  if (!from || !to)       throw new Error('from and to are required');
  if (value === undefined) throw new Error('value is required');
  if (!validBefore)       throw new Error('validBefore is required');
  if (!nonce)             throw new Error('nonce is required');
  if (!chainId)           throw new Error('chainId is required');

  const domain = getJpycDomain({ chainId, contractAddress });

  const types = {
    TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE,
  };

  const message = {
    from:        from,
    to:          to,
    value:       BigInt(value).toString(),
    validAfter:  BigInt(validAfter ?? 0).toString(),
    validBefore: BigInt(validBefore).toString(),
    nonce:       nonce,
  };

  return {
    domain,
    types,
    message,
    // EIP-712 完全 payload（Metamask eth_signTypedData_v4 向け）
    rawTypedData: {
      types: {
        EIP712Domain: EIP712_DOMAIN_TYPE,
        ...types,
      },
      domain,
      primaryType: 'TransferWithAuthorization',
      message,
    },
  };
}

/**
 * depositWithAuthorization 用の typed data を構築する
 *
 * BountyEscrow.depositWithAuthorization は transferWithAuthorization と
 * 同じ署名構造を使う（from → BountyEscrow への transfer 委任）。
 * to は必ず BountyEscrow コントラクトアドレスになる。
 *
 * @param {object} params
 * @param {string}        params.from              クライアントアドレス（署名者）
 * @param {string}        params.bountyEscrowAddress BountyEscrow コントラクトアドレス
 * @param {string|bigint} params.value             デポジット額（wei）
 * @param {number|bigint} params.validAfter
 * @param {number|bigint} params.validBefore
 * @param {string}        params.nonce             bytes32 hex
 * @param {number|string} params.chainId
 * @param {string}        [params.jpycAddress]     JPYC コントラクトアドレス
 */
export function buildDepositWithAuthorizationTypedData({
  from,
  bountyEscrowAddress,
  value,
  validAfter,
  validBefore,
  nonce,
  chainId,
  jpycAddress,
}) {
  if (!bountyEscrowAddress) throw new Error('bountyEscrowAddress is required');

  return buildTransferWithAuthorizationTypedData({
    from,
    to: bountyEscrowAddress,
    value,
    validAfter,
    validBefore,
    nonce,
    chainId,
    contractAddress: jpycAddress,
  });
}

/**
 * ランダムな nonce を生成する（bytes32 hex）
 *
 * EIP-3009 では nonce は一意でさえあれば形式は問わない。
 * crypto.getRandomValues を使い予測不可能な値を生成する。
 *
 * @returns {string} 0x プレフィックス付き 32 バイト hex
 */
export function generateNonce() {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Node.js <19 フォールバック（crypto モジュールは同期 import 不可のため動的に解決）
    // Node.js v18+ では globalThis.crypto が利用可能なため通常は到達しない
    throw new Error(
      'globalThis.crypto unavailable. Use Node.js v18+ or pass a nonce explicitly.'
    );
  }
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 現在時刻ベースの validAfter / validBefore を生成する
 *
 * @param {object} [opts]
 * @param {number} [opts.validAfterOffsetSec=0]      現在から何秒後に有効化（0 = 即時）
 * @param {number} [opts.validBeforeOffsetSec=3600]  有効期限までの秒数（デフォルト 1 時間）
 * @returns {{ validAfter: bigint, validBefore: bigint }}
 */
export function buildValidityWindow({
  validAfterOffsetSec = 0,
  validBeforeOffsetSec = 3600,
} = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    validAfter:  now + BigInt(validAfterOffsetSec),
    validBefore: now + BigInt(validBeforeOffsetSec),
  };
}

export {
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  EIP712_DOMAIN_TYPE,
  TRANSFER_WITH_AUTHORIZATION_TYPE,
  JPYC_MAINNET,
};
