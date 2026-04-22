/**
 * tests/integration/mcp-e2e.test.js
 *
 * MCP BountyEscrow E2E 統合テスト
 *
 * 構成:
 *   - pg-mem によるインメモリ PostgreSQL で DB 状態遷移を検証
 *   - MCPツール呼び出し → calldata 生成 → DB 状態遷移の一貫性を確認
 *   - calldata のセレクターと ABI エンコーディングを検証
 *
 * Hardhat local ノードとの連携:
 *   smart-contract-engineer が用意する Hardhat テスト (contracts/test/BountyEscrow.test.js) が
 *   実際のオンチェーン送信を担う。本テストは MCP ↔ DB レイヤーの整合性に特化する。
 */

import { jest } from '@jest/globals';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

// ─── インメモリ DB セットアップ ───────────────────────────────────────────────

const memDb = newDb();

// pg-mem は gen_random_uuid() 未サポートのため関数を登録する
memDb.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'uuid',
  implementation: () => randomUUID(),
  impure: true,
});

memDb.public.none(`
  CREATE TABLE IF NOT EXISTS mcp_tasks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description             TEXT NOT NULL,
    required_skills         TEXT[] DEFAULT '{}',
    deadline                TIMESTAMPTZ,
    difficulty_score        FLOAT,
    recommended_reward_min  INTEGER,
    recommended_reward_max  INTEGER,
    status                  TEXT DEFAULT 'pending',
    created_at              TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT UNIQUE NOT NULL,
    trust_score     FLOAT DEFAULT 50,
    auto_bid_enabled BOOLEAN DEFAULT false,
    max_bid_amount  INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_bids (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID REFERENCES mcp_tasks(id),
    agent_wallet  TEXT NOT NULL,
    bid_amount    INTEGER NOT NULL,
    message       TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_bounties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID REFERENCES mcp_tasks(id),
    client_wallet   TEXT NOT NULL,
    amount          INTEGER NOT NULL,
    job_key         TEXT UNIQUE,
    onchain_job_id  BIGINT,
    status          TEXT NOT NULL DEFAULT 'pending_open',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_bounty_bids (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id         UUID NOT NULL REFERENCES mcp_bounties(id),
    bidder_wallet     TEXT NOT NULL,
    bid_amount        INTEGER NOT NULL,
    deliverable_hash  TEXT,
    onchain_bid_id    BIGINT,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

const pgAdapter = memDb.adapters.createPg();
const mockPool = new pgAdapter.Pool();

const dbMock = {
  query: async (sql, params) => mockPool.query(sql, params),
};

// lib/db.js をモック
jest.unstable_mockModule('../../lib/db.js', () => ({ db: dbMock }));

// lib/trustScore.js をモック（confirm_delivery が依存）
jest.unstable_mockModule('../../lib/trustScore.js', () => ({
  calculateRoleScore: jest.fn().mockResolvedValue({ score: 60, factors: {} }),
}));

// 環境変数設定
process.env.DATABASE_URL = 'postgres://mock:mock@localhost/mock';
process.env.CHAIN_ID = '80002';
process.env.BOUNTY_ESCROW_ADDRESS = '0x' + 'be'.repeat(20);
process.env.BOUNTY_EXPIRY_DAYS = '30';

// ─── MCP tools を動的 import（mock 後） ─────────────────────────────────────

const { default: openBounty }        = await import('../../tools/openBounty.js');
const { default: submitBid }         = await import('../../tools/submitBid.js');
const { default: acceptBid }         = await import('../../tools/acceptBid.js');
const { default: submitDeliverable } = await import('../../tools/submitDeliverable.js');
const { default: claimExpired }      = await import('../../tools/claimExpired.js');
const { default: cancelBounty }      = await import('../../tools/cancelBounty.js');

// ─── テスト定数 ───────────────────────────────────────────────────────────────

const CLIENT_WALLET = '0x' + 'ca'.repeat(20);
const WORKER_WALLET = '0x' + 'wo'.repeat(20);
const AMOUNT_JPYC   = 500;

const SEL_OPEN          = 'df6814f6';
const SEL_BID           = 'ce677693';
const SEL_ACCEPT        = '09dfd4b7';
const SEL_SUBMIT_DELIV  = 'd46600aa';
const SEL_CLAIM_EXPIRED = 'b16e1343';
const SEL_CANCEL        = '3b0b43a6';

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

async function seedTask(status = 'pending') {
  const { rows } = await mockPool.query(
    `INSERT INTO mcp_tasks (description, recommended_reward_min, recommended_reward_max, status)
     VALUES ('E2E test task', 100, 1000, $1) RETURNING id`,
    [status]
  );
  return rows[0].id;
}

function selectorOf(calldata) {
  return calldata.replace(/^0x/, '').slice(0, 8).toLowerCase();
}

// openBounty 返り値の openBounty tx_instruction を取得
function getOpenBountyInstr(result) {
  return result.instructions?.find(i => i.action === 'open_bounty')?.tx_instruction;
}

// bountyId を open 状態に昇格（report_tx_hash 相当）
async function promoteToOpen(bountyId, jobKey) {
  await mockPool.query(
    `UPDATE mcp_bounties SET status = 'open', job_key = $1 WHERE id = $2`,
    [jobKey, bountyId]
  );
}

// submitBid 後に mcp_bounty_bids の id を取得
async function getBountyBidId(bountyId, workerWallet) {
  const { rows } = await mockPool.query(
    `SELECT id FROM mcp_bounty_bids WHERE bounty_id = $1 AND bidder_wallet = $2 LIMIT 1`,
    [bountyId, workerWallet.toLowerCase()]
  );
  return rows[0]?.id;
}

// ─── openBounty ───────────────────────────────────────────────────────────────

describe('openBounty', () => {
  let taskId;
  beforeEach(async () => { taskId = await seedTask(); });

  test('DB に pending_open レコードを作成する', async () => {
    const result = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });

    expect(result.bounty_id).toBeTruthy();
    expect(result.job_key).toMatch(/^0x[0-9a-f]{64}$/);

    const { rows } = await mockPool.query('SELECT * FROM mcp_bounties WHERE id = $1', [result.bounty_id]);
    expect(rows[0].status).toBe('pending_open');
    expect(rows[0].amount).toBe(AMOUNT_JPYC);
    expect(rows[0].client_wallet).toBe(CLIENT_WALLET.toLowerCase());
  });

  test('openBounty calldata のセレクターが 0xdf6814f6', async () => {
    const result = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    const instr = getOpenBountyInstr(result);
    expect(instr).toBeDefined();
    expect(selectorOf(instr.data)).toBe(SEL_OPEN);
  });

  test('500 JPYC の amount が wei に正しく ABI エンコードされる', async () => {
    const result = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: 500 });
    const instr = getOpenBountyInstr(result);
    const data = instr.data.replace(/^0x/, '');
    // selector(8) + jobKey(64) + amount(64)
    expect(data.length).toBe(8 + 64 + 64);
    const amountWei = BigInt('0x' + data.slice(8 + 64));
    expect(amountWei).toBe(BigInt(500) * BigInt(10 ** 18));
  });

  test('重複バウンティは拒否される', async () => {
    await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    await expect(
      openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC })
    ).rejects.toThrow(/既にアクティブなバウンティ/);
  });
});

// ─── submitBid ────────────────────────────────────────────────────────────────

describe('submitBid', () => {
  let taskId, bountyId, jobKey;

  beforeEach(async () => {
    taskId = await seedTask();
    const r = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    bountyId = r.bounty_id;
    jobKey = r.job_key;
    await promoteToOpen(bountyId, jobKey);
  });

  test('pending 入札を mcp_bounty_bids に作成し calldata セレクターが 0xce677693', async () => {
    const result = await submitBid({
      task_id: taskId,
      agent_wallet: WORKER_WALLET,
      bid_amount: AMOUNT_JPYC,
      bounty_id: bountyId,
    });

    expect(result.bounty_id).toBe(bountyId);
    expect(selectorOf(result.tx_instruction.data)).toBe(SEL_BID);

    const bountyBidId = await getBountyBidId(bountyId, WORKER_WALLET);
    expect(bountyBidId).toBeTruthy();

    const { rows } = await mockPool.query('SELECT * FROM mcp_bounty_bids WHERE id = $1', [bountyBidId]);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].bidder_wallet).toBe(WORKER_WALLET.toLowerCase());
  });
});

// ─── acceptBid ────────────────────────────────────────────────────────────────

describe('acceptBid', () => {
  let taskId, bountyId, jobKey, bountyBidId;

  beforeEach(async () => {
    taskId = await seedTask();
    const r = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    bountyId = r.bounty_id;
    jobKey = r.job_key;
    await promoteToOpen(bountyId, jobKey);
    await submitBid({ task_id: taskId, agent_wallet: WORKER_WALLET, bid_amount: AMOUNT_JPYC, bounty_id: bountyId });
    bountyBidId = await getBountyBidId(bountyId, WORKER_WALLET);
    // onchain_bid_id を設定（report_tx_hash 相当）
    await mockPool.query(`UPDATE mcp_bounty_bids SET onchain_bid_id = 1 WHERE id = $1`, [bountyBidId]);
  });

  test('DB を assigned に更新し calldata セレクターが 0x09dfd4b7', async () => {
    const result = await acceptBid({ bounty_id: bountyId, bid_id: bountyBidId, client_wallet: CLIENT_WALLET });
    expect(selectorOf(result.tx_instruction.data)).toBe(SEL_ACCEPT);

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(rows[0].status).toBe('assigned');
  });

  test('受諾された入札は accepted、他は rejected になる', async () => {
    const worker2 = '0x' + 'bb'.repeat(20);
    await mockPool.query(`UPDATE mcp_bounties SET status = 'open' WHERE id = $1`, [bountyId]);
    await submitBid({ task_id: taskId, agent_wallet: worker2, bid_amount: AMOUNT_JPYC, bounty_id: bountyId });
    const bid2Id = await getBountyBidId(bountyId, worker2);
    await mockPool.query(`UPDATE mcp_bounty_bids SET onchain_bid_id = 2 WHERE id = $1`, [bid2Id]);
    await mockPool.query(`UPDATE mcp_bounties SET status = 'open' WHERE id = $1`, [bountyId]);

    await acceptBid({ bounty_id: bountyId, bid_id: bountyBidId, client_wallet: CLIENT_WALLET });

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounty_bids WHERE id = $1', [bid2Id]);
    expect(rows[0].status).toBe('rejected');
  });

  test('onchain_bid_id = 42 が calldata に正しく ABI エンコードされる', async () => {
    await mockPool.query(`UPDATE mcp_bounty_bids SET onchain_bid_id = 42 WHERE id = $1`, [bountyBidId]);
    const result = await acceptBid({ bounty_id: bountyId, bid_id: bountyBidId, client_wallet: CLIENT_WALLET });

    const data = result.tx_instruction.data.replace(/^0x/, '');
    expect(data.slice(0, 8)).toBe(SEL_ACCEPT);
    expect(BigInt('0x' + data.slice(8 + 64))).toBe(42n);
  });
});

// ─── submitDeliverable ────────────────────────────────────────────────────────

describe('submitDeliverable', () => {
  let bountyId, bountyBidId, jobKey;

  beforeEach(async () => {
    const taskId = await seedTask();
    const r = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    bountyId = r.bounty_id;
    jobKey = r.job_key;
    await promoteToOpen(bountyId, jobKey);
    await submitBid({ task_id: taskId, agent_wallet: WORKER_WALLET, bid_amount: AMOUNT_JPYC, bounty_id: bountyId });
    bountyBidId = await getBountyBidId(bountyId, WORKER_WALLET);
    await mockPool.query(`UPDATE mcp_bounty_bids SET onchain_bid_id = 1 WHERE id = $1`, [bountyBidId]);
    await acceptBid({ bounty_id: bountyId, bid_id: bountyBidId, client_wallet: CLIENT_WALLET });
  });

  test('DB を submitted に更新し calldata セレクターが 0xd46600aa', async () => {
    const DELIVERABLE_HASH = '0x' + 'de'.repeat(32);
    const result = await submitDeliverable({
      bounty_id: bountyId,
      worker_wallet: WORKER_WALLET,
      deliverable_hash: DELIVERABLE_HASH,
    });

    expect(selectorOf(result.tx_instruction.data)).toBe(SEL_SUBMIT_DELIV);

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(rows[0].status).toBe('submitted');
  });
});

// ─── cancelBounty ─────────────────────────────────────────────────────────────

describe('cancelBounty', () => {
  let taskId, bountyId, jobKey;

  beforeEach(async () => {
    taskId = await seedTask();
    const r = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    bountyId = r.bounty_id;
    jobKey = r.job_key;
    await promoteToOpen(bountyId, jobKey);
  });

  test('OPEN → cancelled に更新し calldata セレクターが 0x3b0b43a6', async () => {
    const result = await cancelBounty({ bounty_id: bountyId, client_wallet: CLIENT_WALLET });
    expect(selectorOf(result.tx_instruction.data)).toBe(SEL_CANCEL);

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(rows[0].status).toBe('cancelled');
  });

  test('ASSIGNED 状態では拒否される（ワーカー保護）', async () => {
    await mockPool.query(`UPDATE mcp_bounties SET status = 'assigned' WHERE id = $1`, [bountyId]);
    await expect(
      cancelBounty({ bounty_id: bountyId, client_wallet: CLIENT_WALLET })
    ).rejects.toThrow(/assigned/);
  });
});

// ─── claimExpired ─────────────────────────────────────────────────────────────

describe('claimExpired', () => {
  let taskId, bountyId, jobKey;

  beforeEach(async () => {
    taskId = await seedTask();
    const r = await openBounty({ task_id: taskId, client_wallet: CLIENT_WALLET, amount: AMOUNT_JPYC });
    bountyId = r.bounty_id;
    jobKey = r.job_key;
    const pastDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    await mockPool.query(
      `UPDATE mcp_bounties SET status = 'open', job_key = $1, expires_at = $2 WHERE id = $3`,
      [jobKey, pastDate, bountyId]
    );
  });

  test('期限切れ OPEN → expired に更新し calldata セレクターが 0xb16e1343', async () => {
    const result = await claimExpired({ bounty_id: bountyId, client_wallet: CLIENT_WALLET });
    expect(selectorOf(result.tx_instruction.data)).toBe(SEL_CLAIM_EXPIRED);

    const { rows } = await mockPool.query('SELECT status FROM mcp_bounties WHERE id = $1', [bountyId]);
    expect(rows[0].status).toBe('expired');
  });

  test('期限前のバウンティは拒否される', async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await mockPool.query(`UPDATE mcp_bounties SET expires_at = $1 WHERE id = $2`, [futureDate, bountyId]);
    await expect(
      claimExpired({ bounty_id: bountyId, client_wallet: CLIENT_WALLET })
    ).rejects.toThrow(/期限/);
  });
});
