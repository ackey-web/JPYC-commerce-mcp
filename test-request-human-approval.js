/**
 * SEC-3 回帰テスト: requestHumanApproval の旧デモモード分岐が消えていること
 *
 * 実行方法:
 *   node test-request-human-approval.js
 *
 * ハンドラ本体は lib/db.js (pg.Pool) に依存し DATABASE_URL が必須なため、
 * DB を伴う end-to-end テストは P0-10（ネゴシエーション/エスクロー単体
 * テスト整備）で Neon test ブランチを立ててから実施する。本スクリプトは
 * ソースレベルで「旧デモモード」「auto-approved ハードコード分岐」が
 * 残っていないこと、および INSECURE_TEST_BYPASS_APPROVAL のガードが
 * 存在することを確認する。
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'tools/requestHumanApproval.js'), 'utf8');

// ---------------------------------------------------------------
// Test 1: 旧デモモードのコメント・文字列が完全に除去されている
// ---------------------------------------------------------------
{
  assert.ok(!src.includes('デモフェーズ: 人間承認が必要な場合も自動承認'),
    '旧デモモードコメント（SEC-3 以前）が残っていてはならない');
  assert.ok(!src.includes('手動承認（デモモード）'),
    '旧デモモード message が残っていてはならない');
  console.log('✓ Test1: 旧デモモードの文字列が完全除去');
}

// ---------------------------------------------------------------
// Test 2: 閾値超過または自動承認条件未達のケースで、戻り値として
// 'approved' を返すパターンが消えていること。
// 具体的には「閾値以上 / 手動承認 / pending_human / human_required」
// 付近の return ブロックで status: 'approved' が返っていないこと。
// ---------------------------------------------------------------
{
  // 分岐内の return 文で status 'approved' を返すパターンを抽出
  // 「閾値以上」「人間承認」「pending」の直近で return { status: 'approved' ... } が無いこと
  const humanApprovalRequiredReturnsApproved =
    /(閾値以上|人間承認が必要|pending_(human|approval))[^]*?return\s*\{[^}]*status\s*:\s*['"]approved['"]/;
  const m = src.match(humanApprovalRequiredReturnsApproved);
  // ただし現行実装では「人間承認が必要」コメント直後の return は status: 'pending_human' であり、
  // その後ろの「自動承認」分岐で status: 'approved' を返すのは正しい。
  // よって最初にマッチした return ブロックの status を検証する。
  if (m) {
    // マッチした最初の return ブロック内の status 値を確認
    const firstReturnStatus = m[0].match(/return\s*\{[^}]*status\s*:\s*['"]([^'"]+)['"]/);
    assert.ok(
      firstReturnStatus && firstReturnStatus[1] !== 'approved',
      `人間承認分岐の最初の return で status='approved' が返されている（値=${firstReturnStatus ? firstReturnStatus[1] : 'unknown'}）`
    );
  }
  console.log('✓ Test2: 人間承認必要時は status approved を返していない');
}

// ---------------------------------------------------------------
// Test 3: INSECURE_TEST_BYPASS_APPROVAL のガードが存在すること
// ---------------------------------------------------------------
{
  assert.ok(src.includes('INSECURE_TEST_BYPASS_APPROVAL'),
    'INSECURE_TEST_BYPASS_APPROVAL ガードが存在すべき');
  console.log('✓ Test3: INSECURE_TEST_BYPASS_APPROVAL ガードが存在');
}

// ---------------------------------------------------------------
// Test 4: 人間承認待ちステータスの返却経路が存在すること
// ---------------------------------------------------------------
{
  assert.ok(src.includes('pending_human') || src.includes('pending_approval'),
    '人間承認待ちステータス（pending_human / pending_approval）が存在すべき');
  console.log('✓ Test4: 人間承認待ちステータスの返却経路が存在');
}

// ---------------------------------------------------------------
// Test 5: supabase への参照が完全に消えていること（Neon 完全移行）
// ---------------------------------------------------------------
{
  assert.ok(!/supabase/i.test(src),
    'supabase への参照が残ってはならない（Neon に完全移行済み）');
  console.log('✓ Test5: supabase 参照なし（Neon 完全移行）');
}

console.log('\nSEC-3 回帰テスト: 全パス');
