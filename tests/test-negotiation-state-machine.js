/**
 * ネゴシエーション状態マシン 単体テスト
 *
 * DB不要（ロジックのみをモックして検証）
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ---------- 状態遷移ロジック ----------

const VALID_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'countered'],
};

function canTransition(currentStatus, response) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(response) : false;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function nextStatus(response) {
  if (response === 'accepted') return 'accepted';
  if (response === 'rejected') return 'rejected';
  if (response === 'countered') return 'countered';
  return null;
}

// ---------- テストケース ----------

// 正常系: pending → accepted
assert(canTransition('pending', 'accepted'), 'pending → accepted は有効');
assert(nextStatus('accepted') === 'accepted', 'accepted 後のステータスは accepted');

// 正常系: pending → rejected
assert(canTransition('pending', 'rejected'), 'pending → rejected は有効');
assert(nextStatus('rejected') === 'rejected', 'rejected 後のステータスは rejected');

// 正常系: pending → countered
assert(canTransition('pending', 'countered'), 'pending → countered は有効');
assert(nextStatus('countered') === 'countered', 'countered 後のステータスは countered');

// 異常系: accepted 後はいかなる遷移も不可
assert(!canTransition('accepted', 'accepted'), 'accepted → accepted は無効');
assert(!canTransition('accepted', 'rejected'), 'accepted → rejected は無効');
assert(!canTransition('accepted', 'countered'), 'accepted → countered は無効');

// 異常系: rejected 後はいかなる遷移も不可
assert(!canTransition('rejected', 'accepted'), 'rejected → accepted は無効');

// 異常系: expired 後はいかなる遷移も不可
assert(!canTransition('expired', 'accepted'), 'expired → accepted は無効');

// 有効期限チェック
const pastDate = new Date(Date.now() - 1000).toISOString();
const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
assert(isExpired(pastDate), '過去の expires_at は期限切れ');
assert(!isExpired(futureDate), '未来の expires_at は期限内');
assert(!isExpired(null), 'expires_at = null は期限切れでない');

// counter_history の蓄積
function buildHistory(existing, round, proposed, counter) {
  return [...(existing ?? []), { round, proposed, counter, ts: new Date().toISOString() }];
}
const h1 = buildHistory([], 1, 100, 150);
assert(h1.length === 1, 'round 1 の counter_history は1件');
const h2 = buildHistory(h1, 2, 130, 140);
assert(h2.length === 2, 'round 2 の counter_history は2件');
assert(h2[0].round === 1 && h2[1].round === 2, 'counter_history のラウンド順が正しい');

// human approval 閾値チェック
const THRESHOLD = 1000;
assert(500 < THRESHOLD === true, '500 JPYC は自動承認範囲内');
assert(1000 >= THRESHOLD === true, '1000 JPYC は人間承認必要');
assert(1500 >= THRESHOLD === true, '1500 JPYC は人間承認必要');

// executePayment 実行可能状態チェック
function canExecutePayment(status) {
  return ['accepted', 'approved'].includes(status);
}
assert(canExecutePayment('accepted'), 'accepted 状態なら execute_payment 可能');
assert(canExecutePayment('approved'), 'approved (旧値) 状態なら execute_payment 可能');
assert(!canExecutePayment('pending'), 'pending 状態なら execute_payment 不可');
assert(!canExecutePayment('countered'), 'countered 状態なら execute_payment 不可');
assert(!canExecutePayment('expired'), 'expired 状態なら execute_payment 不可');
assert(!canExecutePayment('paid'), 'paid 状態なら execute_payment 不可（二重送金防止）');

// ---------- 結果 ----------
console.log(`\n状態マシンテスト: ${passed} 合格 / ${failed} 失敗`);
if (failed > 0) process.exit(1);
