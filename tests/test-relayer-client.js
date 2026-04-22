/**
 * tests/test-relayer-client.js
 *
 * Unit tests for lib/relayerClient.js
 * No network calls — mocks globalThis.fetch
 */
import { strict as assert } from 'assert';
import { describe, it, before, after } from 'node:test';

import {
  buildTransferWithAuthorizationCalldata,
  submitRelayedTx,
} from '../lib/relayerClient.js';

// ---------------------------------------------------------------------------
// buildTransferWithAuthorizationCalldata tests
// ---------------------------------------------------------------------------

describe('buildTransferWithAuthorizationCalldata', () => {
  const auth = {
    from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    value: 1000n * 10n ** 18n, // 1000 JPYC in wei
    validAfter: 0,
    validBefore: 9999999999,
    nonce: '0x' + 'cc'.repeat(32),
    v: 27,
    r: '0x' + 'dd'.repeat(32),
    s: '0x' + 'ee'.repeat(32),
  };

  it('should start with EIP-3009 selector 0xe3ee160e', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    assert.ok(calldata.startsWith('0xe3ee160e'), `Expected 0xe3ee160e prefix, got: ${calldata.slice(0, 10)}`);
  });

  it('should be 0x + 4-byte selector + 9 * 32-byte args = 2 + 8 + 576 chars', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    // 0x(2) + selector(8) + 9 args * 64 hex chars = 578
    assert.strictEqual(calldata.length, 2 + 8 + 9 * 64);
  });

  it('should encode `from` address in slot 0 (padded to 32 bytes)', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    const slot0 = calldata.slice(10, 10 + 64); // after 0x + selector
    assert.strictEqual(
      slot0,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.padStart(64, '0')
    );
  });

  it('should encode `to` address in slot 1', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    const slot1 = calldata.slice(10 + 64, 10 + 128);
    assert.strictEqual(
      slot1,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'.padStart(64, '0')
    );
  });

  it('should encode value (1000 JPYC in wei) correctly', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    const slot2 = calldata.slice(10 + 128, 10 + 192);
    const expected = (1000n * 10n ** 18n).toString(16).padStart(64, '0');
    assert.strictEqual(slot2, expected);
  });

  it('should encode nonce as bytes32 (no BigInt conversion)', () => {
    const calldata = buildTransferWithAuthorizationCalldata(auth);
    const slot5 = calldata.slice(10 + 5 * 64, 10 + 6 * 64);
    assert.strictEqual(slot5, 'cc'.repeat(32));
  });
});

// ---------------------------------------------------------------------------
// submitRelayedTx — custom provider tests (with fetch mock)
// ---------------------------------------------------------------------------

describe('submitRelayedTx — custom provider', () => {
  const origFetch = globalThis.fetch;
  const origProvider = process.env.RELAYER_PROVIDER;
  const origUrl = process.env.RELAYER_URL;

  before(() => {
    process.env.RELAYER_PROVIDER = 'custom';
    process.env.RELAYER_URL = 'https://mock-relayer.test/relay';
  });

  after(() => {
    globalThis.fetch = origFetch;
    process.env.RELAYER_PROVIDER = origProvider ?? '';
    process.env.RELAYER_URL = origUrl ?? '';
  });

  const dummyAuth = {
    from: '0x' + 'aa'.repeat(20),
    to: '0x' + 'bb'.repeat(20),
    value: '1000000000000000000',
    validAfter: 0,
    validBefore: 9999999999,
    nonce: '0x' + '00'.repeat(32),
    v: 27,
    r: '0x' + 'cc'.repeat(32),
    s: '0x' + 'dd'.repeat(32),
  };

  it('should return txHash from custom relayer response { txHash }', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ txHash: '0xdeadbeef' }),
      text: async () => '',
    });

    const result = await submitRelayedTx({
      signedAuthorization: dummyAuth,
      target: '0x' + 'ff'.repeat(20),
      data: '0xe3ee160e' + '00'.repeat(9 * 32),
      chainId: 80002,
    });

    assert.strictEqual(result, '0xdeadbeef');
  });

  it('should also accept { transactionHash } in response', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ transactionHash: '0xcafebabe' }),
      text: async () => '',
    });

    const result = await submitRelayedTx({
      signedAuthorization: dummyAuth,
      target: '0x' + 'ff'.repeat(20),
      data: '0xe3ee160e' + '00'.repeat(9 * 32),
      chainId: 80002,
    });

    assert.strictEqual(result, '0xcafebabe');
  });

  it('should throw when relayer returns non-ok response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await assert.rejects(
      () =>
        submitRelayedTx({
          signedAuthorization: dummyAuth,
          target: '0x' + 'ff'.repeat(20),
          data: '0xe3ee160e',
          chainId: 80002,
        }),
      /Custom relayer failed \(500\)/
    );
  });

  it('should throw when response is missing txHash', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
      text: async () => '',
    });

    await assert.rejects(
      () =>
        submitRelayedTx({
          signedAuthorization: dummyAuth,
          target: '0x' + 'ff'.repeat(20),
          data: '0xe3ee160e',
          chainId: 80002,
        }),
      /missing txHash/
    );
  });

  it('should throw when RELAYER_URL is missing for custom provider', async () => {
    const savedUrl = process.env.RELAYER_URL;
    process.env.RELAYER_URL = '';

    await assert.rejects(
      () =>
        submitRelayedTx({
          signedAuthorization: dummyAuth,
          target: '0x' + 'ff'.repeat(20),
          data: '0xe3ee160e',
          chainId: 80002,
        }),
      /RELAYER_URL is required/
    );

    process.env.RELAYER_URL = savedUrl;
  });
});
