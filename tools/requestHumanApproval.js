/**
 * Tool 4 (v2): request_human_approval
 * 人間に交渉条件の承認を求める
 *
 * 自動承認モード:
 * - エージェントの auto_payment_enabled = true
 * - エージェントの trust_score >= auto_payment_threshold
 * - 提示額 <= auto_payment_limit
 * - プラットフォーム全体の自動送金が有効
 * - 1日の送金回数制限内
 * 上記全てを満たす場合、人間承認をスキップして自動承認する
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ negotiation_id }) {
  // 交渉データを取得
  const { data: negotiation, error } = await supabase
    .from('mcp_negotiations')
    .select('*')
    .eq('id', negotiation_id)
    .single();

  if (error || !negotiation) {
    throw new Error(`交渉ID ${negotiation_id} が見つかりません`);
  }

  // エージェントプロファイルを取得
  const { data: agent } = await supabase
    .from('mcp_agents')
    .select('*')
    .eq('wallet_address', negotiation.agent_wallet)
    .single();

  // プラットフォーム設定を取得
  const { data: platformConfig } = await supabase
    .from('mcp_auto_payment_config')
    .select('*')
    .limit(1)
    .single();

  // --- 自動承認判定 ---
  const autoApprovalResult = checkAutoApproval(agent, negotiation, platformConfig);

  let status;
  let message;
  let autoApproved = false;

  if (autoApprovalResult.eligible) {
    // 自動承認
    status = 'approved';
    message = `自動承認: ${autoApprovalResult.reason}`;
    autoApproved = true;

    // 日次カウンタ更新
    await incrementDailyPaymentCount(agent);

    console.error('[auto-approval] 自動承認実行');
    console.error(`  エージェント: ${negotiation.agent_wallet}`);
    console.error(`  trust_score: ${agent.trust_score}`);
    console.error(`  提示額: ${negotiation.proposed_amount} JPYC`);
  } else {
    // 人間承認が必要
    console.error('=== 人間承認リクエスト ===');
    console.error(`交渉ID: ${negotiation.id}`);
    console.error(`エージェント: ${negotiation.agent_wallet}`);
    console.error(`提示額: ${negotiation.proposed_amount} JPYC`);
    console.error(`根拠: ${negotiation.rationale}`);
    console.error(`自動承認不可: ${autoApprovalResult.reason}`);
    console.error('========================');

    // デモフェーズ: 人間承認が必要な場合も自動承認（本番ではelicitation等に置き換え）
    status = 'approved';
    message = `手動承認（デモモード）: ${autoApprovalResult.reason}`;
  }

  // mcp_negotiations の status を更新
  const { error: updateNegError } = await supabase
    .from('mcp_negotiations')
    .update({ status })
    .eq('id', negotiation_id);

  if (updateNegError) {
    throw new Error(`交渉ステータス更新失敗: ${updateNegError.message}`);
  }

  // 関連する mcp_tasks の status を 'approved' に更新
  if (negotiation.task_id) {
    await supabase
      .from('mcp_tasks')
      .update({ status: 'approved' })
      .eq('id', negotiation.task_id);
  }

  return { status, message, auto_approved: autoApproved };
}

/**
 * 自動承認の条件チェック
 */
function checkAutoApproval(agent, negotiation, platformConfig) {
  // プラットフォーム全体で自動送金が無効
  if (!platformConfig?.enabled) {
    return { eligible: false, reason: 'プラットフォームの自動送金が無効' };
  }

  // エージェントが存在しない or 自動送金未有効化
  if (!agent || !agent.auto_payment_enabled) {
    return { eligible: false, reason: 'エージェントの自動送金が無効' };
  }

  // trust_score が閾値未満
  const threshold = agent.auto_payment_threshold ?? platformConfig.default_threshold ?? 50;
  if (agent.trust_score < threshold) {
    return {
      eligible: false,
      reason: `trust_score (${agent.trust_score}) が閾値 (${threshold}) 未満`,
    };
  }

  // 提示額がエージェント個別の上限を超過
  const agentLimit = agent.auto_payment_limit ?? platformConfig.max_single_payment ?? 1000;
  if (negotiation.proposed_amount > agentLimit) {
    return {
      eligible: false,
      reason: `提示額 (${negotiation.proposed_amount}) がエージェント上限 (${agentLimit}) を超過`,
    };
  }

  // プラットフォームの1回あたり上限を超過
  if (negotiation.proposed_amount > (platformConfig.max_single_payment ?? 1000)) {
    return {
      eligible: false,
      reason: `提示額がプラットフォーム上限 (${platformConfig.max_single_payment}) を超過`,
    };
  }

  // 日次送金回数制限チェック
  const today = new Date().toISOString().split('T')[0];
  const dailyReset = agent.daily_payment_reset;
  const dailyCount = (dailyReset === today) ? agent.daily_payment_count : 0;
  const maxDaily = platformConfig.max_daily_payments ?? 10;

  if (dailyCount >= maxDaily) {
    return {
      eligible: false,
      reason: `本日の送金回数上限 (${maxDaily}回) に到達`,
    };
  }

  return {
    eligible: true,
    reason: `trust_score=${agent.trust_score} >= ${threshold}, 額=${negotiation.proposed_amount} <= ${agentLimit}`,
  };
}

/**
 * 日次送金カウンタをインクリメント
 */
async function incrementDailyPaymentCount(agent) {
  const today = new Date().toISOString().split('T')[0];
  const isNewDay = agent.daily_payment_reset !== today;

  await supabase
    .from('mcp_agents')
    .update({
      daily_payment_count: isNewDay ? 1 : agent.daily_payment_count + 1,
      daily_payment_reset: today,
    })
    .eq('id', agent.id);
}
