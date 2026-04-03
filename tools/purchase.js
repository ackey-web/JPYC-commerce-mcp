/**
 * Tool 12 (v2): purchase — ノンカストディアル
 *
 * MCPはエスクロー送金のトランザクション指示を返すだけ。
 * 実際の送金はエージェント（買い手）が自分で署名・送信する。
 * 送信後に report_tx_hash で結果を報告する。
 */
import { supabase } from '../lib/supabase.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';

const ESCROW_ADDRESS = process.env.ESCROW_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

export default async function handler({ product_id, buyer_wallet }) {
  const normalized = buyer_wallet.toLowerCase();

  // 商品取得
  const { data: product, error: prodError } = await supabase
    .from('mcp_products')
    .select('*')
    .eq('id', product_id)
    .single();

  if (prodError || !product) {
    throw new Error(`商品ID ${product_id} が見つかりません`);
  }

  if (product.status !== 'active') {
    throw new Error(`この商品は現在 ${product.status} 状態です`);
  }

  if (product.stock === 0) {
    throw new Error('在庫切れです');
  }

  if (product.seller_wallet === normalized) {
    throw new Error('自分の商品は購入できません');
  }

  // 買い手プロファイル確認（なければ作成）
  let { data: buyer } = await supabase
    .from('mcp_agents')
    .select('id, buyer_score, buyer_total_count')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!buyer) {
    const { data: newBuyer } = await supabase
      .from('mcp_agents')
      .insert({ wallet_address: normalized })
      .select('id, buyer_score, buyer_total_count')
      .single();
    buyer = newBuyer;
  }

  // 売り手情報
  const { data: seller } = await supabase
    .from('mcp_agents')
    .select('seller_score, seller_total_count')
    .eq('wallet_address', product.seller_wallet)
    .maybeSingle();

  // エスクロー送金の指示を生成（MCPは実行しない）
  const escrowInstruction = buildTransferFromInstruction(
    normalized,
    ESCROW_ADDRESS,
    product.price
  );

  // 注文作成（pending — エスクロー送金はまだ）
  const { data: order, error: orderError } = await supabase
    .from('mcp_orders')
    .insert({
      product_id,
      seller_wallet: product.seller_wallet,
      buyer_wallet: normalized,
      amount: product.price,
      status: 'pending',
      escrow_tx_hash: null, // エージェントが送信後に報告
    })
    .select('id')
    .single();

  if (orderError) {
    throw new Error(`注文作成失敗: ${orderError.message}`);
  }

  // 在庫を減らす（-1 = 無限の場合はスキップ）
  if (product.stock > 0) {
    const newStock = product.stock - 1;
    await supabase
      .from('mcp_products')
      .update({
        stock: newStock,
        status: newStock === 0 ? 'sold_out' : 'active',
      })
      .eq('id', product_id);
  }

  // 買い手のtotal_countをインクリメント
  await supabase
    .from('mcp_agents')
    .update({ buyer_total_count: (buyer.buyer_total_count || 0) + 1 })
    .eq('wallet_address', normalized);

  // 売り手のtotal_countをインクリメント
  if (seller) {
    await supabase
      .from('mcp_agents')
      .update({ seller_total_count: (seller.seller_total_count || 0) + 1 })
      .eq('wallet_address', product.seller_wallet);
  }

  return {
    order_id: order.id,
    product_name: product.name,
    amount: product.price,
    buyer_wallet: normalized,
    seller_wallet: product.seller_wallet,
    buyer_score: buyer.buyer_score,
    seller_score: seller?.seller_score ?? 0,
    escrow_instruction: escrowInstruction,
    status: 'pending',
    next_step: 'エージェントが escrow_instruction のトランザクションに署名・送信し、report_tx_hash で結果を報告してください',
  };
}
