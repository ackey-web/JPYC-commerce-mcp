/**
 * tests/integration/mcp-e2e-hardhat.test.js
 *
 * MCP BountyEscrow E2E テスト（Hardhat local + MockJPYC 実送信版）
 *
 * 実行前提:
 *   1. Hardhat ノード起動: cd contracts && npx hardhat node
 *   2. MockJPYC + BountyEscrow のデプロイアドレスを環境変数に設定
 *      HARDHAT_BOUNTY_ESCROW_ADDRESS=0x...
 *      HARDHAT_MOCK_JPYC_ADDRESS=0x...
 *   3. Neon DB（またはローカル PostgreSQL）が DATABASE_URL に設定済み
 *
 * smart-contract-engineer の contracts/test/integration/fullFlow.test.js と役割分担:
 *   - fullFlow.test.js: Hardhat 内でコントラクト直呼び出しの状態遷移を検証
 *   - 本テスト:        MCP tool → calldata → Hardhat broadcast → DB 状態遷移の E2E を検証
 *
 * MCP layer (pg-mem) の検証は tests/integration/mcp-e2e.test.js が担当（13テスト通過済み）
 */

import { jest } from '@jest/globals';
import { ethers } from 'ethers';
import {
  getHardhatProvider,
  getHardhatSigner,
  broadcastInstruction,
  broadcastApprove,
  isHardhatNodeRunning,
  parseEventFromReceipt,
} from './hardhat-helpers.js';

// ─── Hardhat ノード起動確認 ───────────────────────────────────────────────────

const SKIP_IF_NO_NODE = !process.env.HARDHAT_BOUNTY_ESCROW_ADDRESS;

// ─── 環境変数 ─────────────────────────────────────────────────────────────────

const BOUNTY_ESCROW_ADDRESS = process.env.HARDHAT_BOUNTY_ESCROW_ADDRESS || '';
const MOCK_JPYC_ADDRESS     = process.env.HARDHAT_MOCK_JPYC_ADDRESS     || '';

process.env.DATABASE_URL           = process.env.DATABASE_URL || 'postgres://mock:mock@localhost/mock';
process.env.CHAIN_ID               = '31337'; // Hardhat local chainId
process.env.BOUNTY_ESCROW_ADDRESS  = BOUNTY_ESCROW_ADDRESS;
process.env.BOUNTY_EXPIRY_DAYS     = '30';

// ─── DB モック（Hardhat テストでは実DB or pg-mem） ────────────────────────────

import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const memDb = newDb();
memDb.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'uuid',
  implementation: () => randomUUID(),
  impure: true,
});

memDb.public.none(`
  CREATE TABLE IF NOT EXISTS mcp_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    required_skills TEXT[] DEFAULT '{}',
    deadline TIMESTAMPTZ,
    difficulty_score FLOAT,
    recommended_reward_min INTEGER,
    recommended_reward_max INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mcp_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT UNIQUE NOT NULL,
    trust_score FLOAT DEFAULT 50,
    auto_bid_enabled BOOLEAN DEFAULT false,
    max_bid_amount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mcp_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES mcp_tasks(id),
    agent_wallet TEXT NOT NULL,
    bid_amount INTEGER NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mcp_bounties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES mcp_tasks(id),
    client_wallet TEXT NOT NULL,
    amount INTEGER NOT NULL,
    job_key TEXT UNIQUE,
    onchain_job_id BIGINT,
    status TEXT NOT NULL DEFAULT 'pending_open',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mcp_bounty_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id UUID NOT NULL REFERENCES mcp_bounties(id),
    bidder_wallet TEXT NOT NULL,
    bid_amount INTEGER NOT NULL,
    deliverable_hash TEXT,
    onchain_bid_id BIGINT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

const pgAdapter = memDb.adapters.createPg();
const mockPool = new pgAdapter.Pool();

jest.unstable_mockModule('../../lib/db.js', () => ({
  db: { query: (sql, params) => mockPool.query(sql, params) },
}));
jest.unstable_mockModule('../../lib/trustScore.js', () => ({
  calculateRoleScore: jest.fn().mockResolvedValue({ score: 60, factors: {} }),
}));

// ─── MCP tools ────────────────────────────────────────────────────────────────

const { default: openBounty }        = await import('../../tools/openBounty.js');
const { default: submitBid }         = await import('../../tools/submitBid.js');
const { default: acceptBid }         = await import('../../tools/acceptBid.js');
const { default: submitDeliverable } = await import('../../tools/submitDeliverable.js');
const { default: cancelBounty }      = await import('../../tools/cancelBounty.js');
const { default: claimExpired }      = await import('../../tools/claimExpired.js');

// ─── ABI（Hardhat broadcast 用） ──────────────────────────────────────────────

// BountyEscrow 最小 ABI（イベント解析用）
const BOUNTY_ESCROW_ABI = [
  'event BountyOpened(bytes32 indexed jobKey, address indexed client, uint128 amount)',
  'event BidSubmitted(bytes32 indexed jobKey, uint64 indexed bidId, address indexed bidder)',
  'event BidAccepted(bytes32 indexed jobKey, uint64 indexed bidId)',
  'event DeliverableSubmitted(bytes32 indexed jobKey, bytes32 deliverableHash)',
  'event BountyReleased(bytes32 indexed jobKey, address indexed worker, uint128 workerAmount)',
  'event BountyCancelled(bytes32 indexed jobKey)',
  'event BountyExpired(bytes32 indexed jobKey)',
];

// MockJPYC 最小 ABI
const MOCK_JPYC_ABI = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address) external view returns (uint256)',
];

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

async function seedTask(pool, status = 'pending') {
  const { rows } = await pool.query(
    `INSERT INTO mcp_tasks (description, recommended_reward_min, recommended_reward_max, status)
     VALUES ('Hardhat E2E task', 100, 1000, $1) RETURNING id`,
    [status]
  );
  return rows[0].id;
}

async function getBountyBidId(pool, bountyId, workerWallet) {
  const { rows } = await pool.query(
    `SELECT id FROM mcp_bounty_bids WHERE bounty_id = $1 AND bidder_wallet = $2 LIMIT 1`,
    [bountyId, workerWallet.toLowerCase()]
  );
  return rows[0]?.id;
}

// ─── テストスイート ───────────────────────────────────────────────────────────

const AMOUNT_JPYC = 100;

// Hardhat ノードが未起動の場合はスキップ
const describeOrSkip = SKIP_IF_NO_NODE ? describe.skip : describe;

describeOrSkip('MCP BountyEscrow E2E — Hardhat local 実送信', () => {
  let provider, clientSigner, workerSigner;
  let jpyc, escrowIface;

  beforeAll(async () => {
    if (!await isHardhatNodeRunning()) {
      throw new Error('Hardhat node not running. Start with: cd contracts && npx hardhat node');
    }

    provider     = getHardhatProvider();
    clientSigner = getHardhatSigner(1); // account[1]
    workerSigner = getHardhatSigner(2); // account[2]

    jpyc       = new ethers.Contract(MOCK_JPYC_ADDRESS, MOCK_JPYC_ABI, getHardhatSigner(0));
    escrowIface = new ethers.Interface(BOUNTY_ESCROW_ABI);

    // client に 10,000 JPYC を mint
    await jpyc.mint(clientSigner.address, ethers.parseUnits('10000', 18));
  });

  test('openBounty: calldata broadcast → BountyOpened イベント', async () => {
    const taskId = await seedTask(mockPool);
    const result = await openBounty({
      task_id: taskId,
      client_wallet: clientSigner.address,
      amount: AMOUNT_JPYC,
    });

    // step1: approve
    const approveInstr = result.instructions.find(i => i.action === 'approve');
    await broadcastApprove(approveInstr.tx_instruction, clientSigner);

    // step2: openBounty
    const openInstr = result.instructions.find(i => i.action === 'open_bounty');
    const receipt = await broadcastInstruction(openInstr.tx_instruction, clientSigner);

    expect(receipt.status).toBe(1);

    // BountyOpened イベント確認
    const event = parseEventFromReceipt(receipt, escrowIface, 'BountyOpened');
    expect(event).not.toBeNull();
    expect(event.args.client.toLowerCase()).toBe(clientSigner.address.toLowerCase());
    expect(event.args.amount).toBe(ethers.parseUnits(String(AMOUNT_JPYC), 18));

    // DB 状態確認
    const { rows } = await mockPool.query('SELECT * FROM mcp_bounties WHERE id = $1', [result.bounty_id]);
    expect(rows[0].status).toBe('pending_open');
  });

  test('full flow: openBounty → submitBid → acceptBid → submitDeliverable', async () => {
    const taskId = await seedTask(mockPool);

    // openBounty
    const openResult = await openBounty({
      task_id: taskId,
      client_wallet: clientSigner.address,
      amount: AMOUNT_JPYC,
    });
    const { bounty_id: bountyId, job_key: jobKey } = openResult;

    const approveInstr = openResult.instructions.find(i => i.action === 'approve');
    await broadcastApprove(approveInstr.tx_instruction, clientSigner);
    const openInstr = openResult.instructions.find(i => i.action === 'open_bounty');
    await broadcastInstruction(openInstr.tx_instruction, clientSigner);

    // DB を open に昇格
    await mockPool.query(
      `UPDATE mcp_bounties SET status = 'open', job_key = $1 WHERE id = $2`,
      [jobKey, bountyId]
    );

    // submitBid
    const bidResult = await submitBid({
      task_id: taskId,
      agent_wallet: workerSigner.address,
      bid_amount: AMOUNT_JPYC,
      bounty_id: bountyId,
    });
    const bidReceipt = await broadcastInstruction(bidResult.tx_instruction, workerSigner);
    expect(bidReceipt.status).toBe(1);

    const bidEvent = parseEventFromReceipt(bidReceipt, escrowIface, 'BidSubmitted');
    expect(bidEvent).not.toBeNull();
    const onchainBidId = bidEvent.args.bidId;

    // bounty_bid の onchain_bid_id を登録
    const bountyBidId = await getBountyBidId(mockPool, bountyId, workerSigner.address);
    await mockPool.query(
      `UPDATE mcp_bounty_bids SET onchain_bid_id = $1 WHERE id = $2`,
      [onchainBidId, bountyBidId]
    );

    // acceptBid
    const acceptResult = await acceptBid({
      bounty_id: bountyId,
      bid_id: bountyBidId,
      client_wallet: clientSigner.address,
    });
    const acceptReceipt = await broadcastInstruction(acceptResult.tx_instruction, clientSigner);
    expect(acceptReceipt.status).toBe(1);

    const { rows: bRows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(bRows[0].status).toBe('assigned');

    // submitDeliverable
    const delivHash = '0x' + 'de'.repeat(32);
    const delivResult = await submitDeliverable({
      bounty_id: bountyId,
      worker_wallet: workerSigner.address,
      deliverable_hash: delivHash,
    });
    const delivReceipt = await broadcastInstruction(delivResult.tx_instruction, workerSigner);
    expect(delivReceipt.status).toBe(1);

    const { rows: dRows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(dRows[0].status).toBe('submitted');
  });

  test('cancelBounty: OPEN → cancelled on-chain + DB', async () => {
    const taskId = await seedTask(mockPool);
    const openResult = await openBounty({
      task_id: taskId,
      client_wallet: clientSigner.address,
      amount: AMOUNT_JPYC,
    });
    const { bounty_id: bountyId, job_key: jobKey } = openResult;

    const approveInstr = openResult.instructions.find(i => i.action === 'approve');
    await broadcastApprove(approveInstr.tx_instruction, clientSigner);
    const openInstr = openResult.instructions.find(i => i.action === 'open_bounty');
    await broadcastInstruction(openInstr.tx_instruction, clientSigner);
    await mockPool.query(
      `UPDATE mcp_bounties SET status = 'open', job_key = $1 WHERE id = $2`,
      [jobKey, bountyId]
    );

    const cancelResult = await cancelBounty({ bounty_id: bountyId, client_wallet: clientSigner.address });
    const cancelReceipt = await broadcastInstruction(cancelResult.tx_instruction, clientSigner);
    expect(cancelReceipt.status).toBe(1);

    const event = parseEventFromReceipt(cancelReceipt, escrowIface, 'BountyCancelled');
    expect(event).not.toBeNull();

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(rows[0].status).toBe('cancelled');
  });
});
