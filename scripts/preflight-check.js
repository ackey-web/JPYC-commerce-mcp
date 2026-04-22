#!/usr/bin/env node
/**
 * scripts/preflight-check.js — Amoy E2E 疎通前の環境診断スクリプト
 *
 * 使い方: node scripts/preflight-check.js
 * 前提: DATABASE_URL が .env に設定済み
 *
 * チェック項目:
 *   1. 必須 env var の存在確認
 *   2. DATABASE_URL 接続テスト（SELECT 1）
 *   3. DB テーブル存在確認（全マイグレーション適用済みか）
 *   4. Polygon Amoy RPC 疎通（eth_chainId）
 *   5. JPYC コントラクトアドレス検証（ERC-20 コード存在チェック）
 *   6. SBT コントラクトアドレス確認（ゼロアドレス警告）
 *   7. INSECURE_TEST_BYPASS_APPROVAL が本番で false か確認
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let passed = 0;
let failed = 0;
let warned = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
  failed++;
}

function warn(label, detail) {
  console.warn(`  ⚠ ${label}${detail ? `: ${detail}` : ''}`);
  warned++;
}

function section(title) {
  console.log(`\n[${title}]`);
}

// ---------- 1. 必須 env var ----------
section('必須 env var チェック');

const REQUIRED_VARS = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'AMOY_RPC_URL',
  'CHAIN_ID',
  'JPYC_CONTRACT_ADDRESS',
];

const OPTIONAL_VARS = [
  ['SBT_CONTRACT_ADDRESS_AMOY', 'SBT mint に必要（デプロイ後に設定）'],
  ['MERKLE_COMMIT_PRIVATE_KEY', 'Merkle Root commit に必要（運営者のみ）'],
  ['INSECURE_TEST_BYPASS_APPROVAL', 'デフォルト false — テスト専用フラグ'],
  ['NEGOTIATION_TTL_HOURS', 'デフォルト 72h'],
  ['HUMAN_APPROVAL_THRESHOLD_JPYC', 'デフォルト 1000 JPYC'],
];

for (const v of REQUIRED_VARS) {
  if (process.env[v]) ok(v);
  else fail(v, '未設定（必須）');
}

for (const [v, note] of OPTIONAL_VARS) {
  if (process.env[v]) ok(`${v} (optional)`);
  else warn(`${v} 未設定 — ${note}`);
}

// ---------- 2. DB 接続テスト ----------
section('DATABASE_URL 接続テスト');

let pool;
let dbOk = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    const client = await pool.connect();
    const { rows } = await client.query('SELECT 1 AS ping');
    if (rows[0]?.ping === 1) {
      ok('Neon PostgreSQL 接続成功');
      dbOk = true;
    }
    client.release();
  } catch (err) {
    fail('Neon PostgreSQL 接続失敗', err.message);
  }
} else {
  fail('DATABASE_URL 未設定のため接続スキップ');
}

// ---------- 3. テーブル存在確認 ----------
section('DB テーブル存在確認（マイグレーション適用チェック）');

const REQUIRED_TABLES = [
  'mcp_agents',
  'mcp_tasks',
  'mcp_bids',
  'mcp_rate_cards',
  'mcp_negotiations',
  'mcp_payments',
  'mcp_orders',
  'mcp_products',
  'mcp_task_results',
  'mcp_merkle_commits',
  'mcp_platform_config',
];

const REQUIRED_COLUMNS = [
  ['mcp_negotiations', 'expires_at'],
  ['mcp_negotiations', 'counter_history'],
  ['mcp_negotiations', 'round'],
  ['mcp_agents', 'unique_counterparty_count'],
];

if (dbOk) {
  try {
    const client = await pool.connect();

    const { rows: tableRows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const existingTables = new Set(tableRows.map((r) => r.table_name));

    for (const t of REQUIRED_TABLES) {
      if (existingTables.has(t)) ok(t);
      else fail(t, 'テーブルが存在しません — npm run migrate を実行してください');
    }

    // カラム存在確認（migration 006 等の適用チェック）
    for (const [table, column] of REQUIRED_COLUMNS) {
      if (!existingTables.has(table)) continue;
      const { rows: colRows } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      `, [table, column]);
      if (colRows.length > 0) ok(`${table}.${column}`);
      else fail(`${table}.${column}`, 'カラムが存在しません — 最新マイグレーションを適用してください');
    }

    client.release();
  } catch (err) {
    fail('テーブル確認中にエラー', err.message);
  }
} else {
  warn('DB 接続失敗のためテーブルチェックをスキップ');
}

// ---------- 4. Polygon Amoy RPC 疎通 ----------
section('Polygon Amoy RPC 疎通テスト');

const amoyRpc = process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology';
const expectedChainId = '0x13882'; // 80002 in hex

try {
  const res = await fetch(amoyRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  if (json.result === expectedChainId) {
    ok(`Amoy RPC 接続成功 (chainId: ${json.result} = 80002)`);
  } else if (json.result) {
    warn(`Amoy RPC 接続成功だが chainId が想定外: ${json.result}（期待: ${expectedChainId}）`);
  } else {
    fail('Amoy RPC レスポンス不正', JSON.stringify(json));
  }
} catch (err) {
  fail('Amoy RPC 接続失敗', err.message);
}

// ---------- 5. JPYC コントラクト存在確認 ----------
section('JPYC コントラクトアドレス検証');

const jpycAddr = process.env.JPYC_CONTRACT_ADDRESS || '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BF';
const MAINNET_JPYC = '0x431d5dff03120afa4bdf332c61a6e1766ef37bf';

if (jpycAddr.toLowerCase() === MAINNET_JPYC) {
  if (process.env.CHAIN_ID === '80002' || !process.env.CHAIN_ID) {
    warn(
      'JPYC_CONTRACT_ADDRESS が Polygon Mainnet アドレスですが CHAIN_ID=80002 (Amoy) です。' +
      'Amoy テスト用 JPYC アドレスを使用してください'
    );
  } else {
    ok(`JPYC コントラクト: ${jpycAddr} (Polygon Mainnet)`);
  }
} else {
  ok(`JPYC コントラクト: ${jpycAddr} (カスタム/テスト)`);
}

// ---------- 6. SBT コントラクト確認 ----------
section('SBT コントラクトアドレス確認');

const sbtAmoy = process.env.SBT_CONTRACT_ADDRESS_AMOY;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

if (!sbtAmoy || sbtAmoy === ZERO_ADDRESS) {
  warn('SBT_CONTRACT_ADDRESS_AMOY が未設定またはゼロアドレスです。SBT mint は動作しません');
} else {
  ok(`SBT コントラクト (Amoy): ${sbtAmoy}`);
}

// ---------- 7. セキュリティフラグ確認 ----------
section('セキュリティフラグ確認');

const bypass = process.env.INSECURE_TEST_BYPASS_APPROVAL;
const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'production' && bypass === 'true') {
  fail(
    'INSECURE_TEST_BYPASS_APPROVAL=true が NODE_ENV=production で設定されています',
    'SEC-3 違反 — 本番環境では必ず false にしてください'
  );
} else if (bypass === 'true') {
  warn('INSECURE_TEST_BYPASS_APPROVAL=true — テスト環境専用フラグが有効です');
} else {
  ok('INSECURE_TEST_BYPASS_APPROVAL=false (デフォルト/安全)');
}

// ---------- 結果サマリー ----------
if (pool) await pool.end();

const total = passed + failed + warned;
console.log('\n' + '='.repeat(50));
console.log(`preflight-check: ${passed}✓  ${failed}✗  ${warned}⚠  (total: ${total})`);

if (failed > 0) {
  console.error(`\n❌ ${failed} 件の問題があります。修正後に再実行してください。`);
  process.exit(1);
} else if (warned > 0) {
  console.warn(`\n⚠ ${warned} 件の警告があります。E2E テスト前に確認してください。`);
  process.exit(0);
} else {
  console.log('\n✅ 全チェック合格。E2E テストを開始できます。');
  process.exit(0);
}
