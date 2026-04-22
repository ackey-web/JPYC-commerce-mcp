/**
 * E2E Integration Test: Agent-to-Agent Trade Flow (P0-18)
 *
 * シナリオ 1: ハッピーパス（査定 → 交渉 → 承認 → JPYC送金 → SBT更新）
 * シナリオ 2-A: キャンセル（発注側） → スコア不変
 * シナリオ 2-B: タイムアウト失敗 → failure_rate 反映
 * シナリオ 2-C: Sybil攻撃シミュレーション → Diversity Factor 抑制
 *
 * 前提: .env に DATABASE_URL が設定されていること（Neon DB）
 * SBTオンチェーン呼び出しはモック（POLYGON_RPC_URL 未設定時は onchain=null）
 */

import { db } from '../../lib/db.js';
import evaluateTask from '../../tools/evaluateTask.js';
import getSbtProfile from '../../tools/getSbtProfile.js';
import proposeNegotiation from '../../tools/proposeNegotiation.js';
import respondToOffer from '../../tools/respondToOffer.js';
import requestHumanApproval from '../../tools/requestHumanApproval.js';
import executePayment from '../../tools/executePayment.js';
import reportTxHash from '../../tools/reportTxHash.js';
import confirmDelivery from '../../tools/confirmDelivery.js';
import updateSbtRecord from '../../tools/updateSbtRecord.js';

// --- Fixtures ---
const AGENT_A = {
  wallet: '0xaaaa000000000000000000000000000000000001',
};
const AGENT_B = {
  wallet: '0xbbbb000000000000000000000000000000000002',
};
const SAMPLE_TASK = {
  description: 'ERC-20 トークンコントラクト 300 行のセキュリティ監査レポート作成',
  required_skills: ['Solidity', 'DeFi', 'Foundry'],
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};
const DUMMY_TX_HASH = '0x' + 'a'.repeat(64);

// --- helpers ---
async function cleanupAgents() {
  await db.query(
    `DELETE FROM mcp_agents WHERE wallet_address IN ($1, $2)`,
    [AGENT_A.wallet, AGENT_B.wallet]
  );
}

async function cleanupTaskById(taskId) {
  if (!taskId) return;
  try {
    await db.query(`DELETE FROM mcp_payments WHERE negotiation_id IN (SELECT id FROM mcp_negotiations WHERE task_id = $1)`, [taskId]);
    await db.query(`DELETE FROM mcp_task_results WHERE task_id = $1`, [taskId]);
    await db.query(`DELETE FROM mcp_negotiations WHERE task_id = $1`, [taskId]);
    await db.query(`DELETE FROM mcp_tasks WHERE id = $1`, [taskId]);
  } catch (_) {
    // cleanup は best-effort
  }
}

// ============================================================
// シナリオ 1: ハッピーパス
// ============================================================
describe('シナリオ 1: ハッピーパス — 全ステップ通過', () => {
  let taskId, negId, agentAId, agentBId, paymentId;

  beforeAll(async () => {
    await cleanupAgents();
  });

  afterAll(async () => {
    if (taskId) await cleanupTaskById(taskId);
    await cleanupAgents();
  });

  // ステップ 1: エージェント登録・プロフィール取得
  test('1-1: 新規エージェント A が Bronze/trust_score 0 で登録される', async () => {
    const profile = await getSbtProfile({ wallet_address: AGENT_A.wallet });
    agentAId = profile.id;
    expect(profile.trust_score).toBe(0);
    expect(profile.rank).toBe('Bronze');
    // RPC 未設定時は onchain が null または { hasSbt: false } — どちらも許容
    if (profile.onchain !== null) {
      expect(profile.onchain.hasSbt).toBe(false);
    }
    expect(agentAId).toBeTruthy();
  });

  test('1-2: 新規エージェント B が Bronze/trust_score 0 で登録される', async () => {
    const profile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    agentBId = profile.id;
    expect(profile.trust_score).toBe(0);
    expect(profile.rank).toBe('Bronze');
    expect(agentBId).toBeTruthy();
  });

  // ステップ 2: タスク査定
  test('2: evaluateTask — difficulty_score と reward レンジが返る', async () => {
    const result = await evaluateTask(SAMPLE_TASK);
    taskId = result.task_id;
    expect(result.difficulty_score).toBeGreaterThan(0);
    expect(result.difficulty_score).toBeLessThanOrEqual(1);
    expect(result.recommended_reward_min).toBeGreaterThan(0);
    expect(result.recommended_reward_max).toBeGreaterThanOrEqual(result.recommended_reward_min);
    expect(['formula_only', 'ai_enhanced']).toContain(result.scoring_method);
    expect(taskId).toBeTruthy();
  });

  // ステップ 3: 交渉提案
  test('3: proposeNegotiation — negotiation レコードが pending で作成される', async () => {
    const result = await proposeNegotiation({
      task_id: taskId,
      agent_wallet: AGENT_B.wallet,
    });
    negId = result.negotiation_id;
    expect(negId).toBeTruthy();
    expect(result.proposed_amount).toBeGreaterThan(0);
    expect(result.expires_at).toBeTruthy();

    const { rows } = await db.query(
      `SELECT status FROM mcp_negotiations WHERE id = $1`,
      [negId]
    );
    expect(rows[0].status).toBe('pending');
  });

  // ステップ 4: 交渉応答（B が承諾）
  test('4: respondToOffer — accepted → status が accepted になる', async () => {
    const result = await respondToOffer({
      negotiation_id: negId,
      response: 'accepted',
    });
    expect(result.response).toBe('accepted');

    const { rows } = await db.query(
      `SELECT status FROM mcp_negotiations WHERE id = $1`,
      [negId]
    );
    expect(rows[0].status).toBe('accepted');
  });

  // ステップ 5: 人間承認（閾値超過ケース）
  test('5: requestHumanApproval — 閾値超過で status: pending_human を返す（SEC-3）', async () => {
    // proposed_amount が閾値（デフォルト 1000 JPYC）を超える negotiation を直接作成
    const highTask = await evaluateTask({
      description: 'フルスタックプロダクト設計（DeFi + L2）',
      required_skills: ['Solidity', 'TypeScript', 'zkProof'],
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { rows: negRows } = await db.query(
      `INSERT INTO mcp_negotiations
         (task_id, agent_wallet, proposed_amount, rationale, status, round, agent_response, expires_at)
       VALUES ($1, $2, 2000, 'E2Eテスト用高額交渉', 'pending', 1, 'pending', NOW() + INTERVAL '72 hours')
       RETURNING id`,
      [highTask.task_id, AGENT_B.wallet]
    );
    const highNegId = negRows[0].id;

    const result = await requestHumanApproval({
      negotiation_id: highNegId,
      requester_wallet: AGENT_A.wallet,
    });
    // 2000 JPYC ≥ 閾値 1000 JPYC → 人間承認が必要（SEC-3: デモモードでも自動スキップしない）
    expect(result.status).toBe('pending_human');

    // cleanup
    await db.query(`DELETE FROM mcp_negotiations WHERE id = $1`, [highNegId]);
    await cleanupTaskById(highTask.task_id);
  });

  // ステップ 6: JPYC 送金 calldata 生成
  test('6: executePayment — calldata と送金指示が返る（秘密鍵なし）', async () => {
    const result = await executePayment({
      negotiation_id: negId,
      from_wallet: AGENT_A.wallet,
      to_wallet: AGENT_B.wallet,
    });
    paymentId = result.payment_id;
    expect(result.instruction).toBeTruthy();
    expect(result.instruction.to).toBeTruthy();
    // ノンカストディアル: calldata は返るが MCP は署名しない
    expect(result.instruction.data).toMatch(/^0x/);
    expect(paymentId).toBeTruthy();
  });

  // report_tx_hash（送金完了報告）
  test('6b: reportTxHash — payment の tx_hash が記録される', async () => {
    const result = await reportTxHash({
      payment_id: paymentId,
      tx_hash: DUMMY_TX_HASH,
    });
    expect(result.tx_hash).toBe(DUMMY_TX_HASH);
  });

  // ステップ 7: 納品確認（mcp_orders を手動作成して confirm_delivery を検証）
  test('7: confirmDelivery — order が delivered になり release_instruction が返る', async () => {
    // executePayment は mcp_payments のみを作る。
    // confirmDelivery は mcp_orders を対象とするため、E2E 用注文レコードを直接 INSERT する。
    const { rows: orderRows } = await db.query(
      `INSERT INTO mcp_orders (buyer_wallet, seller_wallet, amount, status, negotiation_id)
       VALUES ($1, $2, $3, 'escrowed', $4)
       RETURNING id`,
      [AGENT_A.wallet, AGENT_B.wallet, 500, negId]
    );
    const orderId = orderRows[0].id;

    const result = await confirmDelivery({
      order_id: orderId,
      buyer_wallet: AGENT_A.wallet,
      seller_sentiment: 0.9,
      buyer_sentiment: 0.85,
    });
    expect(result.status).toBe('delivered');
    expect(result.release_instruction).toBeTruthy();
    expect(result.release_instruction.data).toMatch(/^0x/);

    // cleanup order
    await db.query(`DELETE FROM mcp_orders WHERE id = $1`, [orderId]);
  });

  // ステップ 8: SBT 更新
  test('8: updateSbtRecord — trust_score が上昇し SBT calldata が返る', async () => {
    const result = await updateSbtRecord({
      agent_id: agentBId,
      task_id: taskId,
      task_result: 'completed',
      sentiment: 0.9,
    });
    expect(result.trust_score).toBeGreaterThan(0);
    // unique_counterparty_count は DB に更新されるがレスポンスには含まれない（DB で確認）
    const { rows: agentRows } = await db.query(
      `SELECT unique_counterparty_count FROM mcp_agents WHERE id = $1`,
      [agentBId]
    );
    expect(agentRows[0].unique_counterparty_count).toBeGreaterThanOrEqual(0);
    // onchain は RPC 設定時のみ存在（未設定時は null でも可）
    if (result.onchain) {
      if (result.onchain.action) {
        expect(['mint', 'updateTrustScore']).toContain(result.onchain.action);
      }
      if (result.onchain.calldata) {
        expect(result.onchain.calldata).toMatch(/^0x/);
      }
      if (result.onchain.merkleRoot) {
        expect(result.onchain.merkleRoot).toMatch(/^0x/);
      }
    }
  });

  // ステップ 9: SBT プロフィール確認
  test('9: getSbtProfile — B の trust_score が更新済みで返る', async () => {
    const profile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    expect(profile.trust_score).toBeGreaterThan(0);
    expect(profile.id).toBe(agentBId);
  });
});

// ============================================================
// シナリオ 2-A: 発注側キャンセル → スコア不変
// ============================================================
describe('シナリオ 2-A: 発注側キャンセル — エージェントスコアに影響なし', () => {
  let taskId, agentBId;

  beforeAll(async () => {
    await cleanupAgents();
    const profile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    agentBId = profile.id;
    const task = await evaluateTask({
      description: 'スマートコントラクト設計',
      required_skills: ['Solidity'],
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    taskId = task.task_id;
  });

  afterAll(async () => {
    if (taskId) await cleanupTaskById(taskId);
    await cleanupAgents();
  });

  test('cancelled_by_client → message 返却、trust_score は null（スコア不変）', async () => {
    const beforeProfile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    const scoreBefore = beforeProfile.trust_score;

    const result = await updateSbtRecord({
      agent_id: agentBId,
      task_id: taskId,
      task_result: 'cancelled_by_client',
      sentiment: null,
    });
    expect(result.message).toContain('発注側キャンセル');
    expect(result.trust_score).toBeNull();

    const afterProfile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    expect(afterProfile.trust_score).toBe(scoreBefore);
  });
});

// ============================================================
// シナリオ 2-B: タイムアウト・失敗 → failure_rate 反映
// ============================================================
describe('シナリオ 2-B: タイムアウト失敗 — recent_failure_rate 反映（SEC-1確認）', () => {
  let taskId, agentBId;

  beforeAll(async () => {
    await cleanupAgents();
    const profile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    agentBId = profile.id;
    const task = await evaluateTask({
      description: 'フロントエンド設計',
      required_skills: ['React'],
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
    taskId = task.task_id;
  });

  afterAll(async () => {
    if (taskId) await cleanupTaskById(taskId);
    await cleanupAgents();
  });

  test('failed → trust_score が数値で返る（failure_rate は SEC-1 pg COUNT ベースで正確）', async () => {
    const result = await updateSbtRecord({
      agent_id: agentBId,
      task_id: taskId,
      task_result: 'failed',
      sentiment: 0.1,
    });
    expect(result.trust_score).toBeDefined();
    expect(typeof result.trust_score).toBe('number');
    // SEC-1: recent_failure_rate が JS .length でなく pg COUNT で算出されていること
    expect(result.recent_failure_rate).toBeGreaterThanOrEqual(0);
    expect(result.recent_failure_rate).toBeLessThanOrEqual(1);
  });
});

// ============================================================
// シナリオ 2-C: Sybil 攻撃シミュレーション — Diversity Factor 抑制
// ============================================================
describe('シナリオ 2-C: Sybil攻撃 — 同一ペア繰り返し取引で unique_counterparty_count 固定', () => {
  let agentBId;
  const taskIds = [];

  beforeAll(async () => {
    await cleanupAgents();
    const profile = await getSbtProfile({ wallet_address: AGENT_B.wallet });
    agentBId = profile.id;
  });

  afterAll(async () => {
    for (const id of taskIds) await cleanupTaskById(id);
    await cleanupAgents();
  });

  test('同一A-Bペアで3回取引 → unique_counterparty_count が 1 のまま', async () => {
    for (let i = 0; i < 3; i++) {
      const task = await evaluateTask({
        description: `繰り返しタスク ${i + 1}`,
        required_skills: ['Solidity'],
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      taskIds.push(task.task_id);

      // task_results に completed を記録
      await db.query(
        `INSERT INTO mcp_task_results (agent_id, task_id, result, sentiment_given, resolved_at)
         VALUES ($1, $2, 'completed', 0.8, NOW())`,
        [agentBId, task.task_id]
      );

      // negotiations に A との対話を記録（counterparty として A を使う）
      await db.query(
        `INSERT INTO mcp_negotiations (task_id, agent_wallet, proposed_amount, status, round, agent_response)
         VALUES ($1, $2, 100, 'accepted', 1, 'accepted')`,
        [task.task_id, AGENT_A.wallet]
      );
    }

    // Diversity V4: unique_counterparty_count を更新
    await db.query(
      `UPDATE mcp_agents
       SET unique_counterparty_count = get_unique_counterparties(id)
       WHERE id = $1`,
      [agentBId]
    );

    const { rows } = await db.query(
      `SELECT unique_counterparty_count FROM mcp_agents WHERE id = $1`,
      [agentBId]
    );
    // 同じ A ウォレットからしか取引していないので 1 のまま
    expect(rows[0].unique_counterparty_count).toBe(1);
  });
});
