/**
 * Tool 6 (v2): update_agent_record
 * タスク完了後にエージェントの信頼スコアを更新する
 *
 * ファイル名は旧名のまま（index.jsでリネーム済み）
 */
import { supabase } from '../lib/supabase.js';
import { calculateTrustScore } from '../lib/trustScore.js';

export default async function handler({ agent_id, task_id, task_result, sentiment }) {
  const now = new Date().toISOString();

  // --- 1. タスク結果を履歴に記録 ---
  const { error: insertError } = await supabase
    .from('mcp_task_results')
    .insert({
      agent_id,
      task_id,
      result: task_result,
      sentiment_given: sentiment ?? null,
      resolved_at: now,
    });

  if (insertError) {
    throw new Error(`タスク結果記録失敗: ${insertError.message}`);
  }

  // --- 2. 発注側キャンセルはカウントしない ---
  if (task_result === 'cancelled_by_client') {
    return { trust_score: null, message: '発注側キャンセル: エージェントスコアに影響なし' };
  }

  // --- 3. エージェント側キャンセルはfailedと同等 ---
  const effectiveResult = task_result === 'cancelled_by_agent' ? 'failed' : task_result;

  // エージェント取得
  const { data: agent, error: agentError } = await supabase
    .from('mcp_agents')
    .select('*')
    .eq('id', agent_id)
    .single();

  if (agentError || !agent) {
    throw new Error(`エージェントID ${agent_id} が見つかりません`);
  }

  // --- 4. カウンタ更新 ---
  const updates = {
    total_task_count: agent.total_task_count + 1,
    updated_at: now,
  };

  // --- 5. completed / failed 分岐 ---
  if (effectiveResult === 'completed') {
    updates.completion_count = agent.completion_count + 1;
    updates.last_completed_at = now;
  } else {
    updates.completion_count = agent.completion_count;
    updates.last_failed_at = now;
  }

  // --- 6. first_task_at 初期化 ---
  if (!agent.first_task_at) {
    updates.first_task_at = now;
  }

  // --- 7. smoothed_rate 更新（ラプラス平滑化） ---
  updates.smoothed_rate = (updates.completion_count + 1) / (updates.total_task_count + 2);

  // --- 8. active_months 更新 ---
  if (effectiveResult === 'completed') {
    const { data: monthsData } = await supabase.rpc('count_active_months', {
      p_agent_id: agent_id,
    }).single();

    // RPCが使えない場合のフォールバック: 直接クエリ
    if (monthsData?.count != null) {
      updates.active_months = monthsData.count;
    } else {
      const { data: results } = await supabase
        .from('mcp_task_results')
        .select('resolved_at')
        .eq('agent_id', agent_id)
        .eq('result', 'completed');

      if (results) {
        const uniqueMonths = new Set(
          results.map((r) => r.resolved_at.slice(0, 7))
        );
        updates.active_months = uniqueMonths.size;
      }
    }
  } else {
    updates.active_months = agent.active_months;
  }

  // --- 9. avg_sentiment 更新 ---
  let currentSentimentCount = agent.sentiment_count;
  let currentAvgSentiment = agent.avg_sentiment;

  if (effectiveResult === 'completed' && sentiment != null) {
    currentSentimentCount += 1;
    updates.sentiment_count = currentSentimentCount;

    if (currentSentimentCount <= 10) {
      // 10件以下: 単純平均（DBから算出）
      const { data: avgData } = await supabase
        .from('mcp_task_results')
        .select('sentiment_given')
        .eq('agent_id', agent_id)
        .eq('result', 'completed')
        .not('sentiment_given', 'is', null);

      if (avgData && avgData.length > 0) {
        const sum = avgData.reduce((s, r) => s + r.sentiment_given, 0);
        currentAvgSentiment = sum / avgData.length;
      }
    } else {
      // 11件以降: 指数移動平均（α=0.2）
      currentAvgSentiment = 0.8 * currentAvgSentiment + 0.2 * sentiment;
    }
    updates.avg_sentiment = currentAvgSentiment;
  } else {
    updates.avg_sentiment = currentAvgSentiment;
    updates.sentiment_count = currentSentimentCount;
  }

  // --- 10. recent_failure_rate 算出 ---
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentFailures } = await supabase
    .from('mcp_task_results')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent_id)
    .in('result', ['failed', 'timeout'])
    .gte('resolved_at', thirtyDaysAgo);

  const { data: recentTotal } = await supabase
    .from('mcp_task_results')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent_id)
    .in('result', ['completed', 'failed', 'timeout'])
    .gte('resolved_at', thirtyDaysAgo);

  // supabase count with head:true returns count in response
  const failCount = recentFailures?.length ?? 0;
  const totalCount = recentTotal?.length ?? 0;
  const recentFailureRate = totalCount > 0 ? failCount / totalCount : 0;

  // --- 11. trust_score 再計算 ---
  updates.trust_score = calculateTrustScore({
    completion_count: updates.completion_count,
    smoothed_rate: updates.smoothed_rate,
    active_months: updates.active_months,
    avg_sentiment: updates.avg_sentiment,
    recent_failure_rate: recentFailureRate,
  });

  // --- 12. エージェントレコードを保存 ---
  const { error: updateError } = await supabase
    .from('mcp_agents')
    .update(updates)
    .eq('id', agent_id);

  if (updateError) {
    throw new Error(`エージェント更新失敗: ${updateError.message}`);
  }

  return {
    trust_score: updates.trust_score,
    completion_count: updates.completion_count,
    total_task_count: updates.total_task_count,
    smoothed_rate: Math.round(updates.smoothed_rate * 1000) / 1000,
    active_months: updates.active_months,
    avg_sentiment: Math.round(updates.avg_sentiment * 1000) / 1000,
    recent_failure_rate: Math.round(recentFailureRate * 1000) / 1000,
  };
}
