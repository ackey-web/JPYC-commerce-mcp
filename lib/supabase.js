/**
 * Supabase クライアントの遅延初期化ラッパー。
 *
 * SECURITY (SEC-4):
 *   以前は `SUPABASE_SERVICE_ROLE_KEY` 未設定時に `SUPABASE_ANON_KEY` へ
 *   暗黙フォールバックしていたが、書き込み RLS を通過できずに「起動は
 *   成功するが実運用で失敗する」状態を招くため、フォールバックを廃止。
 *   必須 env が揃っていなければ初回利用時に明示的にフェイルファストする。
 *
 *   ANON_KEY はクライアント配布用のキーであり、サーバーサイドの MCP では
 *   絶対に使用してはならない。フォールバック復活は回帰扱い。
 *
 * NOTE (D-2):
 *   DB 方針は Neon 移行が確定済み。backend-engineer の Task #9 で
 *   `lib/db.js` が実装済み。本ファイルは残り未移行ツール（proposeNegotiation,
 *   respondToOffer, executePayment, confirmDelivery, reportTxHash, evaluateTask,
 *   requestHumanApproval, scripts/commitMerkleRoot）が Neon に移行し終えた時点で
 *   削除される予定。
 */
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = {
  SUPABASE_URL: 'Supabase プロジェクトの URL（例: https://xxx.supabase.co）',
  SUPABASE_SERVICE_ROLE_KEY: 'Supabase の service_role キー（サーバー専用）',
};

let _supabase = null;

function assertRequiredEnv() {
  const missing = Object.keys(REQUIRED_ENV).filter((k) => !process.env[k]);
  if (missing.length === 0) return;

  const lines = [
    'Supabase クライアントを初期化できません。以下の環境変数を設定してください:',
    ...missing.map((k) => `  - ${k}: ${REQUIRED_ENV[k]}`),
    '',
    '設定方法:',
    '  1. プロジェクトルートの .env.local に KEY=VALUE を記述',
    '  2. または MCP クライアント設定の env セクションで渡す',
    '',
    'セキュリティ注意: SUPABASE_ANON_KEY は使用不可です（RLS を通過できません）。',
    '必ず service_role キーを設定してください。本番では Neon (lib/db.js) への移行が予定されています。',
  ];
  throw new Error(lines.join('\n'));
}

export function getSupabase() {
  if (_supabase) return _supabase;

  assertRequiredEnv();

  // 誤って ANON_KEY を SUPABASE_SERVICE_ROLE_KEY として設定してしまうケースの簡易検出。
  // Supabase が発行する JWT の payload には role クレームが入っている。
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload && typeof payload.role === 'string' && payload.role !== 'service_role') {
        throw new Error(
          `SUPABASE_SERVICE_ROLE_KEY に role="${payload.role}" のキーが設定されています。` +
          ' service_role キーを設定してください（ANON キーは使用不可）。'
        );
      }
    } catch (e) {
      // JWT デコード失敗は静かに続行（カスタム形式の可能性）。role 判定で明示的に
      // ANON を検出した場合のエラーだけ re-throw。
      if (e && typeof e.message === 'string' && e.message.includes('SUPABASE_SERVICE_ROLE_KEY に role=')) {
        throw e;
      }
    }
  }

  _supabase = createClient(process.env.SUPABASE_URL, key);
  return _supabase;
}

// 後方互換: `import { supabase } from '../lib/supabase.js'` でアクセス可能。
// MCP stdio 起動時は環境変数が先にセットされるため遅延評価で問題ない。
export const supabase = new Proxy({}, {
  get(_, prop) {
    return getSupabase()[prop];
  },
});

/**
 * テスト用: キャッシュされたクライアントをリセットする。
 * 本番コードからは呼ばないこと。
 */
export function __resetSupabaseForTest() {
  _supabase = null;
}
