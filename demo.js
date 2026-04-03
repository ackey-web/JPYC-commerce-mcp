/**
 * デモシナリオ v5: タスク外注 + 商品売買 + 双方向信頼スコア
 *
 * 使い方: node demo.js
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });

import getSbtProfile from './tools/getSbtProfile.js';
import evaluateTask from './tools/evaluateTask.js';
import setRateCard from './tools/setRateCard.js';
import submitBid from './tools/submitBid.js';
import proposeNegotiation from './tools/proposeNegotiation.js';
import respondToOffer from './tools/respondToOffer.js';
import requestHumanApproval from './tools/requestHumanApproval.js';
import executePayment from './tools/executePayment.js';
import updateAgentRecord from './tools/updateSbtRecord.js';
import listProduct from './tools/listProduct.js';
import purchase from './tools/purchase.js';
import confirmDelivery from './tools/confirmDelivery.js';

const SELLER_WALLET = '0xseller_demo_' + Date.now().toString(16);
const BUYER_WALLET = '0xbuyer_demo_' + Date.now().toString(16);
const CLIENT_WALLET = '0xclient_demo_' + Date.now().toString(16);

async function run() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   JPYC Commerce MCP デモ v5 (13 tools)      ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ============================================
  // Part 1: タスク外注フロー（入札 + 交渉）
  // ============================================
  console.log('━━━ Part 1: タスク外注フロー ━━━\n');

  // 1-1: 受注エージェント登録
  console.log('--- 1-1: 受注エージェント登録 ---');
  const agentProfile = await getSbtProfile({ wallet_address: SELLER_WALLET });
  console.log(`  ID: ${agentProfile.id}`);
  console.log(`  trust_score: ${agentProfile.trust_score}`);

  // 1-2: オーナーが料金表を設定
  console.log('\n--- 1-2: オーナーが料金表を設定 (set_rate_card) ---');
  const rateCard = await setRateCard({
    agent_wallet: SELLER_WALLET,
    rates: [
      { skill: 'solidity', rate_per_task: 800, min_acceptable: 500 },
      { skill: 'react', rate_per_task: 400, min_acceptable: 250 },
      { skill: 'python', rate_per_task: 500, min_acceptable: 300 },
    ],
    auto_bid_enabled: true,
    max_bid_amount: 1000,
  });
  console.log(`  登録: ${rateCard.rates_count} スキル`);
  rateCard.rates.forEach(r => console.log(`    ${r.skill}: ${r.rate_per_task} JPYC`));

  // 1-3: 発注側がタスクを査定
  console.log('\n--- 1-3: タスク査定 (evaluate_task) ---');
  const task = await evaluateTask({
    description: 'DeFiプロトコルのフロントエンド改修。React + Solidityの知識が必要。',
    required_skills: ['React', 'Solidity'],
    deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  console.log(`  difficulty: ${task.difficulty_score}`);
  console.log(`  reward range: ${task.recommended_reward_min}〜${task.recommended_reward_max} JPYC`);

  // 1-4: 受注側がrate_cardから自動入札
  console.log('\n--- 1-4: 自動入札 (submit_bid) ---');
  const bid = await submitBid({
    task_id: task.task_id,
    agent_wallet: SELLER_WALLET,
    // bid_amount 省略 → rate_cardから自動算出
  });
  console.log(`  bid_amount: ${bid.bid_amount} JPYC`);
  console.log(`  source: ${bid.bid_source}`);

  // 1-5: 発注側が交渉提案（入札額を考慮）
  console.log('\n--- 1-5: 交渉提案 (propose_negotiation) ---');
  const neg = await proposeNegotiation({
    task_id: task.task_id,
    agent_wallet: SELLER_WALLET,
    bid_id: bid.bid_id,
  });
  console.log(`  proposed: ${neg.proposed_amount} JPYC (round ${neg.round})`);
  console.log(`  rationale: ${neg.rationale}`);

  // 1-6: 受注側がカウンターオファー
  console.log('\n--- 1-6: カウンターオファー (respond_to_offer) ---');
  const counter = await respondToOffer({
    negotiation_id: neg.negotiation_id,
    response: 'countered',
    counter_amount: 750,
    message: 'Solidity監査も含むので750が妥当です',
  });
  console.log(`  counter: ${counter.counter_amount} JPYC`);

  // 1-7: 発注側が再提案（歩み寄り）
  console.log('\n--- 1-7: 再提案 Round 2 (propose_negotiation) ---');
  const neg2 = await proposeNegotiation({
    task_id: task.task_id,
    agent_wallet: SELLER_WALLET,
  });
  console.log(`  proposed: ${neg2.proposed_amount} JPYC (round ${neg2.round})`);

  // 1-8: 受注側が受諾
  console.log('\n--- 1-8: 受諾 (respond_to_offer) ---');
  const accept = await respondToOffer({
    negotiation_id: neg2.negotiation_id,
    response: 'accepted',
  });
  console.log(`  status: ${accept.response}`);
  console.log(`  final_amount: ${accept.final_amount} JPYC`);

  // 1-9: 送金実行
  console.log('\n--- 1-9: JPYC送金 (execute_payment) ---');
  const payment = await executePayment({
    negotiation_id: neg2.negotiation_id,
    from_wallet: CLIENT_WALLET,
    to_wallet: SELLER_WALLET,
  });
  console.log(`  tx: ${payment.tx_hash}`);
  console.log(`  amount: ${payment.amount} JPYC (${payment.mode})`);

  // 1-10: スコア更新
  console.log('\n--- 1-10: スコア更新 (update_agent_record) ---');
  const scoreUpdate = await updateAgentRecord({
    agent_id: agentProfile.id,
    task_id: task.task_id,
    task_result: 'completed',
    sentiment: 0.9,
  });
  console.log(`  trust_score: 0 → ${scoreUpdate.trust_score}`);

  // ============================================
  // Part 2: 商品売買フロー（エスクロー）
  // ============================================
  console.log('\n\n━━━ Part 2: 商品売買フロー ━━━\n');

  // 2-1: 買い手登録
  console.log('--- 2-1: 買い手登録 ---');
  const buyerProfile = await getSbtProfile({ wallet_address: BUYER_WALLET });
  console.log(`  buyer ID: ${buyerProfile.id}`);
  console.log(`  buyer_score: ${buyerProfile.buyer_score || 0}`);

  // 2-2: 売り手が商品を出品
  console.log('\n--- 2-2: 商品出品 (list_product) ---');
  const product = await listProduct({
    seller_wallet: SELLER_WALLET,
    name: 'Solidity監査レポートテンプレート',
    description: 'DeFiプロトコル向けのセキュリティ監査レポートテンプレート。Markdown形式。',
    price: 200,
    category: 'digital',
    stock: 10,
  });
  console.log(`  product_id: ${product.product_id}`);
  console.log(`  ${product.name}: ${product.price} JPYC (在庫: ${product.stock})`);
  console.log(`  seller_score: ${product.seller_score}`);

  // 2-3: 買い手が購入（エスクロー）
  console.log('\n--- 2-3: 購入 → エスクロー (purchase) ---');
  const order = await purchase({
    product_id: product.product_id,
    buyer_wallet: BUYER_WALLET,
  });
  console.log(`  order_id: ${order.order_id}`);
  console.log(`  status: ${order.status}`);
  console.log(`  escrow_tx: ${order.escrow_tx_hash}`);
  console.log(`  buyer_score: ${order.buyer_score}`);
  console.log(`  seller_score: ${order.seller_score}`);

  // 2-4: 受取確認（エスクロー解放 + 双方スコア更新）
  console.log('\n--- 2-4: 受取確認 → エスクロー解放 (confirm_delivery) ---');
  const delivery = await confirmDelivery({
    order_id: order.order_id,
    buyer_wallet: BUYER_WALLET,
    seller_sentiment: 0.95,  // 買い手→売り手の評価
    buyer_sentiment: 0.85,   // 売り手→買い手の評価
  });
  console.log(`  status: ${delivery.status}`);
  console.log(`  release_tx: ${delivery.release_tx_hash}`);
  console.log(`  seller_score updated: ${delivery.seller_score_updated}`);
  console.log(`  buyer_score updated: ${delivery.buyer_score_updated}`);

  // 2-5: 最終プロファイル確認
  console.log('\n--- 2-5: 最終プロファイル ---');
  const finalSeller = await getSbtProfile({ wallet_address: SELLER_WALLET });
  const finalBuyer = await getSbtProfile({ wallet_address: BUYER_WALLET });
  console.log(`  売り手 ${SELLER_WALLET}:`);
  console.log(`    trust_score: ${finalSeller.trust_score} (タスク)`);
  console.log(`    seller_score: ${finalSeller.seller_score} (売り手)`);
  console.log(`  買い手 ${BUYER_WALLET}:`);
  console.log(`    buyer_score: ${finalBuyer.buyer_score} (買い手)`);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   デモ v5 完了                                ║');
  console.log('╚══════════════════════════════════════════════╝');
}

run().catch((err) => {
  console.error('デモ失敗:', err.message);
  console.error(err.stack);
  process.exit(1);
});
