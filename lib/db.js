/**
 * lib/db.js — Neon PostgreSQL 接続（pg.Pool）
 *
 * Rezona パターン準拠。DATABASE_URL 未設定なら起動時 throw。
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[db] DATABASE_URL が設定されていません。.env に DATABASE_URL=postgresql://... を追加してください'
  );
}

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon の SSL 必須
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    _pool.on('error', (err) => {
      console.error('[db] pool error:', err.message);
    });
  }
  return _pool;
}

/**
 * 単一クエリ実行
 * @param {string} text - SQL
 * @param {any[]} [params] - バインドパラメータ
 */
export async function query(text, params) {
  const pool = getPool();
  const result = await pool.query(text, params);
  return result;
}

/**
 * トランザクション helper
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 */
export async function withTransaction(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 接続確認（起動時ヘルスチェック用） */
export async function testConnection() {
  const { rows } = await query('SELECT NOW() AS now');
  return rows[0].now;
}

export const db = { query, withTransaction, testConnection };
