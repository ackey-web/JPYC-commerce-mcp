#!/usr/bin/env node
/**
 * scripts/migrate.js — Neon マイグレーション実行
 *
 * 使い方: node scripts/migrate.js
 * 前提: DATABASE_URL が .env に設定済み
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL が設定されていません');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  join(__dirname, '../migrations/001_init.sql'),
  join(__dirname, '../migrations/004_create_mcp_merkle_commits.sql'),
  join(__dirname, '../migrations/005_diversity_factor.sql'),
];

async function run() {
  const client = await pool.connect();
  try {
    for (const file of migrations) {
      const sql = readFileSync(file, 'utf8');
      console.log(`[migrate] 実行中: ${file}`);
      await client.query(sql);
      console.log(`[migrate] 完了: ${file}`);
    }
    console.log('[migrate] 全マイグレーション完了');
  } catch (err) {
    console.error('[migrate] エラー:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
