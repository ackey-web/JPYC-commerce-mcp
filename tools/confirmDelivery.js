/**
 * Tool 13 (v2): confirm_delivery — ノンカストディアル
 *
 * 買い手が受取確認 → エスクロー解放の指示を返す。
 * MCPはトランザクションを実行しない。エスクローウォレットからの
 * 送金はエスクロー管理者（マルチシグ等）が実行する。
 *
 * 双方の信頼スコアは即時更新する（オフチェーン）。
 */
import { supabase } from '../lib/supabase.js';
import { calculateRoleScore } from '../lib/trustScore.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';

const ESCROW_ADDRESS = process.env.ESCROW_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

export default async function handler({ order_id, buyer_wallet, seller_sentiment, buyer_sentiment }) {
  const normalized = buyer_wallet.toLowerCase();

  // 注文取得
  const { data: order, error: orderError } = await supabase
    .from('mcp_orders')
    .select('*')
    .eq('id', order_id)
    .single();

  if (orderError || !order) {
    throw new Error(`注文ID ${order_id} が見つかりません`);
  }

  if (order.buyer_wallet !== normalized) {
    throw new Error('この注文の買い手のみが受取確認できます');
  }

  if (!['escrowed', 'shipped'].includes(order.status)) {
    throw new Error(`この注文は ${order.status} 状態です。受取確認できるのは escrowed/shipped の注文のみです`);
  }

  // エスクロー解放の指示を生成（MCPは実行しない）
  const releaseInstruction = buildTransferFromInstruction(
    ESCROW_ADDRESS,
    order.seller_wallet,
    order.amount
  );

  // 注文を delivered に更新（スコアは即時反映、エスクロー解放はエージェント/管理者が実行）
  await supabase
    .from('mcp_orders')
    .update({
      status: 'delivered',
      seller_sentiment: seller_sentiment ?? null,
      buyer_sentiment: buyer_sentiment ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order_id);

  // --- 売り手スコア更新 ---
  const { data: seller } = await supabase
    .from('mcp_agents')
    .select('*')
    .eq('wallet_address', order.seller_wallet)
    .single();

  if (seller) {
    const newSellerCompletion = (seller.seller_completion_count || 0) + 1;
    const updates = { seller_completion_count: newSellerCompletion };

    if (seller_sentiment != null) {
      const newCount = (seller.seller_sentiment_count || 0) + 1;
      updates.seller_sentiment_count = newCount;
      if (newCount <= 10) {
        const { data: orders } = await supabase
          .from('mcp_orders')
          .select('seller_sentiment')
          .eq('seller_wallet', order.seller_wallet)
          .not('seller_sentiment', 'is', null);
        if (orders && orders.length > 0) {
          updates.seller_avg_sentiment = orders.reduce((s, o) => s + o.seller_sentiment, 0) / orders.length;
        }
      } else {
        updates.seller_avg_sentiment = 0.8 * (seller.seller_avg_sentiment || 0.5) + 0.2 * seller_sentiment;
      }
    }

    updates.seller_score = calculateRoleScore({ ...seller, ...updates }, 'seller');

    await supabase
      .from('mcp_agents')
      .update(updates)
      .eq('wallet_address', order.seller_wallet);
  }

  // --- 買い手スコア更新 ---
  const { data: buyer } = await supabase
    .from('mcp_agents')
    .select('*')
    .eq('wallet_address', normalized)
    .single();

  if (buyer) {
    const newBuyerCompletion = (buyer.buyer_completion_count || 0) + 1;
    const updates = { buyer_completion_count: newBuyerCompletion };

    if (buyer_sentiment != null) {
      const newCount = (buyer.buyer_sentiment_count || 0) + 1;
      updates.buyer_sentiment_count = newCount;
      if (newCount <= 10) {
        const { data: orders } = await supabase
          .from('mcp_orders')
          .select('buyer_sentiment')
          .eq('buyer_wallet', normalized)
          .not('buyer_sentiment', 'is', null);
        if (orders && orders.length > 0) {
          updates.buyer_avg_sentiment = orders.reduce((s, o) => s + o.buyer_sentiment, 0) / orders.length;
        }
      } else {
        updates.buyer_avg_sentiment = 0.8 * (buyer.buyer_avg_sentiment || 0.5) + 0.2 * buyer_sentiment;
      }
    }

    updates.buyer_score = calculateRoleScore({ ...buyer, ...updates }, 'buyer');

    await supabase
      .from('mcp_agents')
      .update(updates)
      .eq('wallet_address', normalized);
  }

  return {
    order_id,
    amount: order.amount,
    seller_wallet: order.seller_wallet,
    buyer_wallet: normalized,
    status: 'delivered',
    release_instruction: releaseInstruction,
    seller_score_updated: !!seller,
    buyer_score_updated: !!buyer,
    next_step: 'エスクロー管理者が release_instruction のトランザクションを実行し、完了後に注文ステータスを completed に更新してください',
  };
}
