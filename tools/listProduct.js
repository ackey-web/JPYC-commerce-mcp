/**
 * Tool 11: list_product
 * 売り手が商品を出品する
 */
import { supabase } from '../lib/supabase.js';

export default async function handler({ seller_wallet, name, description, price, category, stock, metadata }) {
  const normalized = seller_wallet.toLowerCase();

  // 売り手プロファイル確認（なければ作成）
  let { data: agent } = await supabase
    .from('mcp_agents')
    .select('id, seller_score')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!agent) {
    const { data: newAgent } = await supabase
      .from('mcp_agents')
      .insert({ wallet_address: normalized })
      .select('id, seller_score')
      .single();
    agent = newAgent;
  }

  // バリデーション
  if (price <= 0) throw new Error('price は1以上の整数（JPYC）を指定してください');
  if (stock !== undefined && stock < -1) throw new Error('stock は -1（無限）または 0以上を指定');

  const validCategories = ['digital', 'physical', 'nft'];
  if (category && !validCategories.includes(category)) {
    throw new Error(`category は ${validCategories.join(' / ')} のいずれかを指定してください`);
  }

  // 出品
  const { data: product, error } = await supabase
    .from('mcp_products')
    .insert({
      seller_wallet: normalized,
      name,
      description: description || null,
      price,
      category: category || 'digital',
      stock: stock ?? 1,
      metadata: metadata || null,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`出品失敗: ${error.message}`);
  }

  return {
    product_id: product.id,
    seller_wallet: normalized,
    seller_score: agent.seller_score,
    name,
    price,
    category: category || 'digital',
    stock: stock ?? 1,
    message: `「${name}」を ${price} JPYC で出品しました`,
  };
}
