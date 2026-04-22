/**
 * Tool 4 (v3): request_human_approval
 * 人間に交渉条件の承認を求める
 *
 * 閾値（mcp_platform_config の human_approval_threshold_jpyc）以上の場合は人間承認が必要。
 * 閾値未満は自動承認。デモモードの自動スキップは廃止（SEC-3対応）。
 */
import { db } from '../lib/db.js';

const DEFAULT_THRESHOLD = 1000;

export default async function handler({ negotiation_id }) {
  const { rows: negRows } = await db.query(
    `SELECT * FROM mcp_negotiations WHERE id = $1`,
    [negotiation_id]
  );
  const negotiation = negRows[0];
  if (!negotiation) throw new Error(`交渉ID ${negotiation_id} が見つかりません`);

  // プラットフォーム設定から承認閾値を取得
  const { rows: cfgRows } = await db.query(
    `SELECT value FROM mcp_platform_config WHERE key = 'human_approval_threshold_jpyc'`
  );
  const threshold = cfgRows[0] ? parseInt(cfgRows[0].value, 10) : DEFAULT_THRESHOLD;

  const amount = negotiation.proposed_amount;

  // テスト専用バイパスフラグ（本番では必ず false）
  const bypassApproval = process.env.INSECURE_TEST_BYPASS_APPROVAL === 'true';
  if (bypassApproval) {
    console.error('[WARN] INSECURE_TEST_BYPASS_APPROVAL=true: 人間承認をバイパスしています（テスト専用）');
  }

  if (!bypassApproval && amount >= threshold) {
    // 人間承認が必要
    console.error('=== 人間承認リクエスト ===');
    console.error(`交渉ID: ${negotiation_id}`);
    console.error(`エージェント: ${negotiation.agent_wallet}`);
    console.error(`提示額: ${amount} JPYC（閾値: ${threshold} JPYC）`);
    console.error(`根拠: ${negotiation.rationale}`);
    console.error('========================');

    return {
      status: 'pending_human',
      negotiation_id,
      amount,
      threshold,
      message: `${amount} JPYC は承認閾値 ${threshold} JPYC 以上のため、人間の承認が必要です`,
    };
  }

  // 自動承認（閾値未満またはテストバイパス）
  await db.query(
    `UPDATE mcp_negotiations SET status = 'approved' WHERE id = $1`,
    [negotiation_id]
  );

  if (negotiation.task_id) {
    await db.query(`UPDATE mcp_tasks SET status = 'approved' WHERE id = $1`, [negotiation.task_id]);
  }

  return {
    status: 'approved',
    negotiation_id,
    amount,
    threshold,
    auto_approved: true,
    message: `${amount} JPYC は閾値 ${threshold} JPYC 未満のため自動承認されました`,
  };
}
