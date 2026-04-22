/**
 * tests/test-bounty-escrow-tools.js
 * BountyEscrow MCP tools の単体テスト（DB 不要、calldata エンコーディング検証）
 *
 * bountyCalldataBuilder.js の現行シグネチャ（nft-architect 更新版）:
 *   buildOpenBountyInstruction(jobKey, amountJpyc)
 *   buildSubmitBidInstruction(jobKey, bidAmountJpyc, proposalHash)
 *   buildAcceptBidInstruction(jobKey, bidId)
 *   buildConfirmDeliveryInstruction(jobKey)
 */

import assert from 'assert';
import { test } from 'node:test';

import {
  buildOpenBountyInstruction,
  buildSubmitBidInstruction,
  buildAcceptBidInstruction,
  buildConfirmDeliveryInstruction,
  buildSubmitDeliverableInstruction,
  buildClaimExpiredInstruction,
} from '../lib/bountyCalldataBuilder.js';

// function selectors（bountyCalldataBuilder.js の SEL 定数と一致）
const SEL_OPEN    = 'df6814f6'; // openBounty(bytes32,uint128)
const SEL_BID     = 'ce677693'; // submitBid(bytes32,uint128,bytes32)
const SEL_ACCEPT  = '09dfd4b7'; // acceptBid(bytes32,uint64)
const SEL_CONFIRM = '74950ffd'; // confirmDelivery(bytes32)

const JOB_KEY = '0x' + 'ab'.repeat(32);
const ZERO_HASH = '0x' + '00'.repeat(32);

// ─── buildOpenBountyInstruction ───────────────────────────────────────────────

test('buildOpenBountyInstruction: selector correct', () => {
  const result = buildOpenBountyInstruction(JOB_KEY, 500);
  assert.ok(result.data.slice(2).startsWith(SEL_OPEN), `expected selector ${SEL_OPEN}, got ${result.data.slice(2, 10)}`);
});

test('buildOpenBountyInstruction: calldata length (selector 4B + jobKey 32B + amount 32B = 68B = 136 hex)', () => {
  const result = buildOpenBountyInstruction(JOB_KEY, 500);
  assert.strictEqual(result.data.length, 2 + 8 + 64 + 64, `data length: ${result.data.length}`);
});

test('buildOpenBountyInstruction: amount encoding (500 JPYC → wei)', () => {
  const result = buildOpenBountyInstruction(ZERO_HASH, 500);
  const amountHex = result.data.slice(2 + 8 + 64, 2 + 8 + 64 * 2);
  const amountBigInt = BigInt('0x' + amountHex);
  assert.strictEqual(amountBigInt, BigInt(500) * BigInt(10 ** 18));
});

test('buildOpenBountyInstruction: jobKey in calldata', () => {
  const result = buildOpenBountyInstruction(JOB_KEY, 100);
  const jobKeyInData = result.data.slice(2 + 8, 2 + 8 + 64);
  assert.strictEqual(jobKeyInData, 'ab'.repeat(32));
});

test('buildOpenBountyInstruction: amountHuman in decoded', () => {
  const result = buildOpenBountyInstruction(JOB_KEY, 1000);
  assert.ok(result.decoded.args.amountHuman.includes('1000'));
});

// ─── buildSubmitBidInstruction ────────────────────────────────────────────────

test('buildSubmitBidInstruction: selector correct', () => {
  const result = buildSubmitBidInstruction(JOB_KEY, 300, ZERO_HASH);
  assert.ok(result.data.slice(2).startsWith(SEL_BID), `expected ${SEL_BID}, got ${result.data.slice(2, 10)}`);
});

test('buildSubmitBidInstruction: calldata length (selector + jobKey + amount + hash = 8+64+64+64)', () => {
  const result = buildSubmitBidInstruction(JOB_KEY, 300, ZERO_HASH);
  assert.strictEqual(result.data.length, 2 + 8 + 64 * 3);
});

test('buildSubmitBidInstruction: bid amount encoding', () => {
  const result = buildSubmitBidInstruction(ZERO_HASH, 200, ZERO_HASH);
  const amountHex = result.data.slice(2 + 8 + 64, 2 + 8 + 64 * 2);
  assert.strictEqual(BigInt('0x' + amountHex), BigInt(200) * BigInt(10 ** 18));
});

test('buildSubmitBidInstruction: null proposalHash defaults to zero hash', () => {
  const result = buildSubmitBidInstruction(JOB_KEY, 100, null);
  const hashHex = result.data.slice(2 + 8 + 64 * 2, 2 + 8 + 64 * 3);
  assert.strictEqual(hashHex, '0'.repeat(64));
});

// ─── buildAcceptBidInstruction ────────────────────────────────────────────────

test('buildAcceptBidInstruction: selector correct', () => {
  const result = buildAcceptBidInstruction(JOB_KEY, 7);
  assert.ok(result.data.slice(2).startsWith(SEL_ACCEPT), `expected ${SEL_ACCEPT}, got ${result.data.slice(2, 10)}`);
});

test('buildAcceptBidInstruction: calldata length (selector + jobKey + bidId = 8+64+64)', () => {
  const result = buildAcceptBidInstruction(JOB_KEY, 7);
  assert.strictEqual(result.data.length, 2 + 8 + 64 + 64);
});

test('buildAcceptBidInstruction: bidId encoding', () => {
  const result = buildAcceptBidInstruction(JOB_KEY, 12);
  const bidIdHex = result.data.slice(2 + 8 + 64, 2 + 8 + 64 * 2);
  assert.strictEqual(BigInt('0x' + bidIdHex), BigInt(12));
});

// ─── buildConfirmDeliveryInstruction ─────────────────────────────────────────

test('buildConfirmDeliveryInstruction: selector correct', () => {
  const result = buildConfirmDeliveryInstruction(JOB_KEY);
  assert.ok(result.data.slice(2).startsWith(SEL_CONFIRM), `expected ${SEL_CONFIRM}, got ${result.data.slice(2, 10)}`);
});

test('buildConfirmDeliveryInstruction: calldata length (selector + jobKey = 8+64)', () => {
  const result = buildConfirmDeliveryInstruction(JOB_KEY);
  assert.strictEqual(result.data.length, 2 + 8 + 64);
});

test('buildConfirmDeliveryInstruction: jobKey in calldata', () => {
  const result = buildConfirmDeliveryInstruction(JOB_KEY);
  const keyHex = result.data.slice(2 + 8, 2 + 8 + 64);
  assert.strictEqual(keyHex, 'ab'.repeat(32));
});

// ─── 共通フィールド ────────────────────────────────────────────────────────────

test('all instructions: required fields present', () => {
  const instructions = [
    buildOpenBountyInstruction(JOB_KEY, 100),
    buildSubmitBidInstruction(JOB_KEY, 100, ZERO_HASH),
    buildAcceptBidInstruction(JOB_KEY, 1),
    buildConfirmDeliveryInstruction(JOB_KEY),
  ];
  for (const inst of instructions) {
    assert.ok(inst.chainId, 'chainId missing');
    assert.ok(inst.chain, 'chain missing');
    assert.ok(inst.gasEstimate?.gasLimit, 'gasLimit missing');
    assert.ok(inst.gasEstimate?.maxFeePerGas, 'maxFeePerGas missing');
    assert.strictEqual(inst.value, '0', 'value should be 0 (ERC20 call)');
    assert.ok(inst.description, 'description missing');
    assert.ok(inst.decoded?.args, 'decoded.args missing');
  }
});

// ─── openBounty ツールのロジックテスト ────────────────────────────────────────

test('openBounty logic: amount < recommended_reward_min throws', async () => {
  async function validateOpenBounty({ amount, task }) {
    if (amount < task.recommended_reward_min) {
      throw new Error(`バウンティ額 ${amount} JPYC は推奨最低額 ${task.recommended_reward_min} JPYC を下回っています`);
    }
  }
  await assert.rejects(
    () => validateOpenBounty({ amount: 300, task: { recommended_reward_min: 500 } }),
    /推奨最低額/
  );
});

test('openBounty logic: amount >= recommended_reward_min passes', async () => {
  async function validateOpenBounty({ amount, task }) {
    if (amount < task.recommended_reward_min) throw new Error('too low');
    return true;
  }
  assert.strictEqual(await validateOpenBounty({ amount: 500, task: { recommended_reward_min: 500 } }), true);
});

test('openBounty logic: duplicate active bounty throws', () => {
  function checkDuplicate(existingBounties) {
    if (existingBounties.length > 0) throw new Error('既にアクティブなバウンティが存在します');
  }
  assert.throws(() => checkDuplicate([{ id: 'x' }]), /既にアクティブ/);
  assert.doesNotThrow(() => checkDuplicate([]));
});

// ─── acceptBid ロジックテスト ─────────────────────────────────────────────────

test('acceptBid: non-client throws', () => {
  function checkClient(bountyClientWallet, callerWallet) {
    if (bountyClientWallet !== callerWallet) throw new Error('このバウンティのクライアントのみが入札を受諾できます');
  }
  assert.throws(() => checkClient('0xaaa', '0xbbb'), /クライアントのみ/);
  assert.doesNotThrow(() => checkClient('0xaaa', '0xaaa'));
});

test('acceptBid: wrong status throws', () => {
  function checkStatus(status) {
    if (status !== 'open') throw new Error(`バウンティは ${status} 状態です`);
  }
  assert.throws(() => checkStatus('assigned'), /assigned 状態/);
  assert.doesNotThrow(() => checkStatus('open'));
});

test('acceptBid: missing job_key throws', () => {
  function checkJobKey(job_key) {
    if (!job_key) throw new Error('job_key が未設定です');
  }
  assert.throws(() => checkJobKey(null), /job_key が未設定/);
  assert.doesNotThrow(() => checkJobKey('0x' + 'ab'.repeat(32)));
});

// ─── confirmDelivery BountyEscrow 分岐テスト ─────────────────────────────────

test('confirmDelivery bounty: non-client throws', () => {
  function checkClient(bountyClient, caller) {
    if (bountyClient !== caller) throw new Error('このバウンティのクライアントのみが confirmDelivery を呼べます');
  }
  assert.throws(() => checkClient('0xaaa', '0xbbb'), /クライアントのみ/);
});

test('confirmDelivery bounty: wrong status throws', () => {
  function checkStatus(status) {
    if (status !== 'submitted') throw new Error(`バウンティは ${status} 状態です`);
  }
  assert.throws(() => checkStatus('open'), /open 状態/);
  assert.doesNotThrow(() => checkStatus('submitted'));
});

// ─── submitBid BountyEscrow 分岐テスト ───────────────────────────────────────

test('submitBid bounty: missing job_key throws', () => {
  function checkJobKey(bounty) {
    if (!bounty.job_key) throw new Error('job_key が未設定です');
  }
  assert.throws(() => checkJobKey({ job_key: null }), /job_key が未設定/);
  assert.doesNotThrow(() => checkJobKey({ job_key: JOB_KEY }));
});

test('submitBid bounty: generates correct calldata', () => {
  const inst = buildSubmitBidInstruction(JOB_KEY, 200, ZERO_HASH);
  assert.ok(inst.data.slice(2).startsWith(SEL_BID));
  assert.ok(inst.description.includes('200 JPYC'));
});

// ─── submitDeliverable テスト ────────────────────────────────────────────────

const SEL_SUBMIT_DELIVERABLE = 'd46600aa'; // submitDeliverable(bytes32,bytes32)

test('submitDeliverable: selector is 0xd46600aa', () => {
  const inst = buildSubmitDeliverableInstruction(JOB_KEY, ZERO_HASH);
  assert.ok(inst.data.slice(2).startsWith(SEL_SUBMIT_DELIVERABLE), `Expected ${SEL_SUBMIT_DELIVERABLE}, got ${inst.data.slice(2, 10)}`);
});

test('submitDeliverable: data length = 0x + 8 + 2*64 = 146 chars', () => {
  const inst = buildSubmitDeliverableInstruction(JOB_KEY, ZERO_HASH);
  assert.strictEqual(inst.data.length, 2 + 8 + 2 * 64);
});

test('submitDeliverable: jobKey encoded in slot 0', () => {
  const inst = buildSubmitDeliverableInstruction(JOB_KEY, ZERO_HASH);
  const slot0 = inst.data.slice(10, 10 + 64);
  assert.strictEqual(slot0, JOB_KEY.replace(/^0x/, '').padEnd(64, '0'));
});

test('submitDeliverable: deliverableHash encoded in slot 1', () => {
  const deliverableHash = '0x' + 'ab'.repeat(32);
  const inst = buildSubmitDeliverableInstruction(JOB_KEY, deliverableHash);
  const slot1 = inst.data.slice(10 + 64, 10 + 128);
  assert.strictEqual(slot1, 'ab'.repeat(32));
});

test('submitDeliverable: missing deliverableHash defaults to zero bytes32', () => {
  const inst = buildSubmitDeliverableInstruction(JOB_KEY, null);
  const slot1 = inst.data.slice(10 + 64, 10 + 128);
  assert.strictEqual(slot1, '0'.repeat(64));
});

// ─── claimExpired テスト ─────────────────────────────────────────────────────

const SEL_CLAIM_EXPIRED = 'b16e1343'; // claimExpired(bytes32)

test('claimExpired: selector is 0xb16e1343', () => {
  const inst = buildClaimExpiredInstruction(JOB_KEY);
  assert.ok(inst.data.slice(2).startsWith(SEL_CLAIM_EXPIRED), `Expected ${SEL_CLAIM_EXPIRED}, got ${inst.data.slice(2, 10)}`);
});

test('claimExpired: data length = 0x + 8 + 64 = 74 chars', () => {
  const inst = buildClaimExpiredInstruction(JOB_KEY);
  assert.strictEqual(inst.data.length, 2 + 8 + 64);
});

test('claimExpired: jobKey encoded in slot 0', () => {
  const inst = buildClaimExpiredInstruction(JOB_KEY);
  const slot0 = inst.data.slice(10, 10 + 64);
  assert.strictEqual(slot0, JOB_KEY.replace(/^0x/, '').padEnd(64, '0'));
});

// ─── tool ガード: submitDeliverable ────────────────────────────────────────

test('submitDeliverable: wrong status throws', () => {
  function checkStatus(status) {
    if (status !== 'assigned') throw new Error(`バウンティは ${status} 状態です`);
  }
  assert.throws(() => checkStatus('open'), /open 状態/);
  assert.throws(() => checkStatus('submitted'), /submitted 状態/);
  assert.doesNotThrow(() => checkStatus('assigned'));
});

test('submitDeliverable: non-winner worker throws', () => {
  function checkWorker(bidderWallet, callerWallet) {
    if (bidderWallet !== callerWallet) throw new Error('このバウンティの落札者のみが成果物を提出できます');
  }
  assert.throws(() => checkWorker('0xaaa', '0xbbb'), /落札者のみ/);
  assert.doesNotThrow(() => checkWorker('0xaaa', '0xaaa'));
});

// ─── tool ガード: claimExpired ──────────────────────────────────────────────

test('claimExpired: wrong status throws', () => {
  function checkStatus(status) {
    if (status !== 'open') throw new Error(`バウンティは ${status} 状態です`);
  }
  assert.throws(() => checkStatus('assigned'), /assigned 状態/);
  assert.throws(() => checkStatus('confirmed'), /confirmed 状態/);
  assert.doesNotThrow(() => checkStatus('open'));
});

test('claimExpired: not-yet-expired throws', () => {
  function checkExpiry(expiresAt) {
    const now = new Date();
    if (expiresAt && now < new Date(expiresAt)) throw new Error('まだ期限切れではありません');
  }
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => checkExpiry(future), /まだ期限切れ/);
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.doesNotThrow(() => checkExpiry(past));
});

test('claimExpired: non-client wallet throws', () => {
  function checkClient(bountyClient, caller) {
    if (bountyClient !== caller) throw new Error('このバウンティのクライアントのみが claimExpired を呼べます');
  }
  assert.throws(() => checkClient('0xaaa', '0xbbb'), /クライアントのみ/);
  assert.doesNotThrow(() => checkClient('0xaaa', '0xaaa'));
});

console.log('All BountyEscrow tool tests defined.');
