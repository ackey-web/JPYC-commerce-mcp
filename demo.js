/**
 * デモシナリオ v2: trust_scoreベースのエージェント評価フロー
 *
 * 使い方: node demo.js
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });

import getSbtProfile from './tools/getSbtProfile.js';
import evaluateTask from './tools/evaluateTask.js';
import proposeNegotiation from './tools/proposeNegotiation.js';
import requestHumanApproval from './tools/requestHumanApproval.js';
import executePayment from './tools/executePayment.js';
import updateAgentRecord from './tools/updateSbtRecord.js';

const DEMO_WALLET = '0xdemo_v2_' + Date.now().toString(16);
const SENDER_WALLET = '0x1111222233334444555566667777888899990000';

async function run() {
  console.log('=== GIFTERRA Commerce MCP デモ v2 ===\n');

  // Step 1: エージェントプロファイル取得（新規作成される）
  console.log('--- Step 1: get_sbt_profile ---');
  const profile = await getSbtProfile({ wallet_address: DEMO_WALLET });
  console.log(JSON.stringify(profile, null, 2));

  // Step 2: タスク査定
  console.log('\n--- Step 2: evaluate_task ---');
  const task = await evaluateTask({
    description: 'ScanTarotにカード自動判定精度向上機能を追加',
    required_skills: ['Python', 'TensorFlow', 'OpenCV', 'React'],
    deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  });
  console.log(JSON.stringify(task, null, 2));

  // Step 3: 交渉条件提示（trust_score=0なので最低額になるはず）
  console.log('\n--- Step 3: propose_negotiation ---');
  const negotiation = await proposeNegotiation({
    task_id: task.task_id,
    agent_wallet: DEMO_WALLET,
  });
  console.log(JSON.stringify(negotiation, null, 2));

  // Step 4: 人間承認
  console.log('\n--- Step 4: request_human_approval ---');
  const approval = await requestHumanApproval({
    negotiation_id: negotiation.negotiation_id,
  });
  console.log(JSON.stringify(approval, null, 2));

  // Step 5: 送金実行
  console.log('\n--- Step 5: execute_payment ---');
  const payment = await executePayment({
    negotiation_id: negotiation.negotiation_id,
    from_wallet: SENDER_WALLET,
    to_wallet: DEMO_WALLET,
  });
  console.log(JSON.stringify(payment, null, 2));

  // Step 6: update_agent_record（completed + sentiment）
  console.log('\n--- Step 6: update_agent_record (completed, sentiment=0.85) ---');
  const update1 = await updateAgentRecord({
    agent_id: profile.id,
    task_id: task.task_id,
    task_result: 'completed',
    sentiment: 0.85,
  });
  console.log(JSON.stringify(update1, null, 2));

  // Step 7: プロファイル再取得（trust_scoreが更新されていることを確認）
  console.log('\n--- Step 7: プロファイル再確認 ---');
  const updatedProfile = await getSbtProfile({ wallet_address: DEMO_WALLET });
  console.log(JSON.stringify(updatedProfile, null, 2));
  console.log(`trust_score: 0 → ${updatedProfile.trust_score}`);

  console.log('\n=== デモ v2 完了 ===');
}

run().catch((err) => {
  console.error('デモ失敗:', err.message);
  process.exit(1);
});
