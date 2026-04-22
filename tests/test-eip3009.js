/**
 * tests/test-eip3009.js
 *
 * Unit tests for lib/eip3009.js
 * No network calls, no external dependencies.
 */

import { strict as assert } from 'assert';
import { describe, it } from 'node:test';

import {
  buildTransferWithAuthorizationTypedData,
  buildDepositWithAuthorizationTypedData,
  getJpycDomain,
  generateNonce,
  buildValidityWindow,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  JPYC_MAINNET,
} from '../lib/eip3009.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAIN_ID_AMOY    = 80002;
const CHAIN_ID_MAINNET = 137;
const MOCK_JPYC        = '0x' + 'aa'.repeat(20);
const FROM             = '0x' + '11'.repeat(20);
const TO               = '0x' + '22'.repeat(20);
const BOUNTY_ESCROW    = '0x' + '33'.repeat(20);
const VALUE_WEI        = (1000n * 10n ** 18n).toString(); // 1000 JPYC
const VALID_AFTER      = 0n;
const VALID_BEFORE     = 9999999999n;
const NONCE            = '0x' + 'cc'.repeat(32);

// ---------------------------------------------------------------------------
// getJpycDomain
// ---------------------------------------------------------------------------

describe('getJpycDomain', () => {
  it('returns correct domain for Amoy testnet', () => {
    const domain = getJpycDomain({ chainId: CHAIN_ID_AMOY, contractAddress: MOCK_JPYC });
    assert.strictEqual(domain.name,              'JPY Coin');
    assert.strictEqual(domain.version,           '1');
    assert.strictEqual(domain.chainId,           CHAIN_ID_AMOY);
    assert.strictEqual(domain.verifyingContract, MOCK_JPYC);
  });

  it('defaults to JPYC_MAINNET address when contractAddress is omitted', () => {
    const domain = getJpycDomain({ chainId: CHAIN_ID_MAINNET });
    assert.strictEqual(domain.verifyingContract, JPYC_MAINNET);
    assert.strictEqual(domain.chainId, CHAIN_ID_MAINNET);
  });

  it('casts chainId to number', () => {
    const domain = getJpycDomain({ chainId: '80002', contractAddress: MOCK_JPYC });
    assert.strictEqual(typeof domain.chainId, 'number');
    assert.strictEqual(domain.chainId, 80002);
  });
});

// ---------------------------------------------------------------------------
// buildTransferWithAuthorizationTypedData
// ---------------------------------------------------------------------------

describe('buildTransferWithAuthorizationTypedData', () => {
  const buildArgs = () => ({
    from:         FROM,
    to:           TO,
    value:        VALUE_WEI,
    validAfter:   VALID_AFTER,
    validBefore:  VALID_BEFORE,
    nonce:        NONCE,
    chainId:      CHAIN_ID_AMOY,
    contractAddress: MOCK_JPYC,
  });

  it('returns domain / types / message / rawTypedData', () => {
    const result = buildTransferWithAuthorizationTypedData(buildArgs());
    assert.ok(result.domain,       'domain is missing');
    assert.ok(result.types,        'types is missing');
    assert.ok(result.message,      'message is missing');
    assert.ok(result.rawTypedData, 'rawTypedData is missing');
  });

  it('domain matches JPYC v2 spec', () => {
    const { domain } = buildTransferWithAuthorizationTypedData(buildArgs());
    assert.strictEqual(domain.name,    'JPY Coin');
    assert.strictEqual(domain.version, '1');
    assert.strictEqual(domain.chainId, CHAIN_ID_AMOY);
    assert.strictEqual(domain.verifyingContract, MOCK_JPYC);
  });

  it('types has TransferWithAuthorization with 6 fields', () => {
    const { types } = buildTransferWithAuthorizationTypedData(buildArgs());
    assert.ok(types.TransferWithAuthorization, 'TransferWithAuthorization type missing');
    assert.strictEqual(types.TransferWithAuthorization.length, 6);
  });

  it('message fields match input', () => {
    const { message } = buildTransferWithAuthorizationTypedData(buildArgs());
    assert.strictEqual(message.from,        FROM);
    assert.strictEqual(message.to,          TO);
    assert.strictEqual(message.value,       BigInt(VALUE_WEI).toString());
    assert.strictEqual(message.validAfter,  BigInt(VALID_AFTER).toString());
    assert.strictEqual(message.validBefore, BigInt(VALID_BEFORE).toString());
    assert.strictEqual(message.nonce,       NONCE);
  });

  it('rawTypedData has EIP712Domain type + primaryType', () => {
    const { rawTypedData } = buildTransferWithAuthorizationTypedData(buildArgs());
    assert.strictEqual(rawTypedData.primaryType, 'TransferWithAuthorization');
    assert.ok(rawTypedData.types.EIP712Domain, 'EIP712Domain missing from rawTypedData');
  });

  it('accepts BigInt value', () => {
    const args = { ...buildArgs(), value: 1000n * 10n ** 18n };
    const { message } = buildTransferWithAuthorizationTypedData(args);
    assert.strictEqual(message.value, (1000n * 10n ** 18n).toString());
  });

  it('defaults validAfter to 0 when not provided', () => {
    const args = { ...buildArgs() };
    delete args.validAfter;
    const { message } = buildTransferWithAuthorizationTypedData(args);
    assert.strictEqual(message.validAfter, '0');
  });

  it('throws when from is missing', () => {
    const args = { ...buildArgs(), from: undefined };
    assert.throws(() => buildTransferWithAuthorizationTypedData(args), /from and to are required/);
  });

  it('throws when chainId is missing', () => {
    const args = { ...buildArgs(), chainId: undefined };
    assert.throws(() => buildTransferWithAuthorizationTypedData(args), /chainId is required/);
  });

  it('throws when nonce is missing', () => {
    const args = { ...buildArgs(), nonce: undefined };
    assert.throws(() => buildTransferWithAuthorizationTypedData(args), /nonce is required/);
  });

  it('throws when validBefore is missing', () => {
    const args = { ...buildArgs(), validBefore: undefined };
    assert.throws(() => buildTransferWithAuthorizationTypedData(args), /validBefore is required/);
  });
});

// ---------------------------------------------------------------------------
// buildDepositWithAuthorizationTypedData
// ---------------------------------------------------------------------------

describe('buildDepositWithAuthorizationTypedData', () => {
  it('sets to = bountyEscrowAddress', () => {
    const result = buildDepositWithAuthorizationTypedData({
      from:                FROM,
      bountyEscrowAddress: BOUNTY_ESCROW,
      value:               VALUE_WEI,
      validAfter:          VALID_AFTER,
      validBefore:         VALID_BEFORE,
      nonce:               NONCE,
      chainId:             CHAIN_ID_AMOY,
      jpycAddress:         MOCK_JPYC,
    });
    assert.strictEqual(result.message.to, BOUNTY_ESCROW);
    assert.strictEqual(result.message.from, FROM);
  });

  it('throws when bountyEscrowAddress is missing', () => {
    assert.throws(
      () =>
        buildDepositWithAuthorizationTypedData({
          from:        FROM,
          value:       VALUE_WEI,
          validBefore: VALID_BEFORE,
          nonce:       NONCE,
          chainId:     CHAIN_ID_AMOY,
        }),
      /bountyEscrowAddress is required/
    );
  });

  it('domain uses jpycAddress for verifyingContract', () => {
    const result = buildDepositWithAuthorizationTypedData({
      from:                FROM,
      bountyEscrowAddress: BOUNTY_ESCROW,
      value:               VALUE_WEI,
      validBefore:         VALID_BEFORE,
      nonce:               NONCE,
      chainId:             CHAIN_ID_MAINNET,
      jpycAddress:         JPYC_MAINNET,
    });
    assert.strictEqual(result.domain.verifyingContract, JPYC_MAINNET);
    assert.strictEqual(result.domain.chainId, CHAIN_ID_MAINNET);
  });
});

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe('generateNonce', () => {
  it('returns 0x-prefixed 32-byte hex string', () => {
    const nonce = generateNonce();
    assert.ok(nonce.startsWith('0x'), 'nonce should start with 0x');
    assert.strictEqual(nonce.length, 2 + 64, 'nonce should be 32 bytes = 64 hex chars');
  });

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()));
    assert.strictEqual(nonces.size, 20, 'nonces should be unique');
  });

  it('nonce is lowercase hex', () => {
    const nonce = generateNonce();
    assert.match(nonce, /^0x[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// buildValidityWindow
// ---------------------------------------------------------------------------

describe('buildValidityWindow', () => {
  it('validBefore > validAfter', () => {
    const { validAfter, validBefore } = buildValidityWindow();
    assert.ok(validBefore > validAfter, 'validBefore should be after validAfter');
  });

  it('default window is 1 hour (3600s)', () => {
    const { validAfter, validBefore } = buildValidityWindow();
    const diff = validBefore - validAfter;
    assert.ok(diff >= 3599n && diff <= 3601n, `Expected ~3600s diff, got ${diff}`);
  });

  it('custom validBeforeOffsetSec is applied', () => {
    const { validAfter, validBefore } = buildValidityWindow({ validBeforeOffsetSec: 7200 });
    const diff = validBefore - validAfter;
    assert.ok(diff >= 7199n && diff <= 7201n, `Expected ~7200s diff, got ${diff}`);
  });

  it('returns bigint values', () => {
    const { validAfter, validBefore } = buildValidityWindow();
    assert.strictEqual(typeof validAfter,  'bigint');
    assert.strictEqual(typeof validBefore, 'bigint');
  });
});

// ---------------------------------------------------------------------------
// TRANSFER_WITH_AUTHORIZATION_TYPEHASH constant
// ---------------------------------------------------------------------------

describe('TRANSFER_WITH_AUTHORIZATION_TYPEHASH', () => {
  it('is a 0x-prefixed 32-byte hex', () => {
    assert.match(
      TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
      /^0x[0-9a-f]{64}$/,
      'TYPEHASH should be a 32-byte hex'
    );
  });

  it('matches known value from EIP-3009 spec', () => {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    assert.strictEqual(
      TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
      '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267'
    );
  });
});
