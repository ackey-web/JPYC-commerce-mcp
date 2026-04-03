/**
 * Tool 12: purchase
 * 買い手が商品を購入する（エスクロー方式）
 *
 * フロー:
 * 1. 商品の存在・在庫・ステータスを確認
 * 2. 買い手の buyer_score を確認（売り手が最低スコアを設定可能）
 * 3. JPYC をエスクローアドレスに送金（or モック）
 * 4. mcp_orders に escrowed 状態で記録
 * 5. 在庫を減らす
 *
 * エスクロー解放は confirm_delivery で実行
 */
import { supabase } from '../lib/supabase.js';

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

  // 自分の商品は買えない
  if (product.seller_wallet === normalized) {
    throw new Error('自分の商品は購入できません');
  }

  // 買い手プロファイル確認（なければ作成）
  let { data: buyer } = await supabase
    .from('mcp_agents')
    .select('id, buyer_score')
    .eq('wallet_address', normalized)
    .maybeSingle();

  if (!buyer) {
    const { data: newBuyer } = await supabase
      .from('mcp_agents')
      .insert({ wallet_address: normalized })
      .select('id, buyer_score')
      .single();
    buyer = newBuyer;
  }

  // 売り手情報
  const { data: seller } = await supabase
    .from('mcp_agents')
    .select('seller_score')
    .eq('wallet_address', product.seller_wallet)
    .single();

  // エスクロー送金（JPYC）
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const escrowAddress = process.env.ESCROW_WALLET_ADDRESS;
  let escrowTxHash;

  if (relayerKey && escrowAddress) {
    // 本番モード: エスクローウォレットに送金
    const { ethers } = await import('ethers');
    const rpcUrl = process.env.VITE_ALCHEMY_RPC_URL || process.env.POLYGON_RPC_URL;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const relayerWallet = new ethers.Wallet(relayerKey, provider);

    const jpycAddress = process.env.JPYC_CONTRACT_ADDRESS || '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
    const ERC20_ABI = [
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
    ];
    const jpyc = new ethers.Contract(jpycAddress, ERC20_ABI, relayerWallet);
    const amountWei = BigInt(product.price) * BigInt(10 ** 18);

    // 残高・allowanceチェック
    const balance = await jpyc.balanceOf(normalized);
    if (balance.lt(amountWei)) {
      throw new Error(`JPYC残高不足: ${normalized} の残高が ${product.price} JPYC 未満です`);
    }

    const allowance = await jpyc.allowance(normalized, relayerWallet.address);
    if (allowance.lt(amountWei)) {
      throw new Error(`JPYC allowance不足: Relayerへの承認額が ${product.price} JPYC 未満です`);
    }

    const tx = await jpyc.transferFrom(normalized, escrowAddress, amountWei, {
      maxFeePerGas: ethers.utils.parseUnits('200', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      gasLimit: 100000,
    });
    await tx.wait();
    escrowTxHash = tx.hash;
  } else {
    // デモモード
    escrowTxHash = `mock_escrow_${Date.now()}`;
  }

  // 注文作成
  const { data: order, error: orderError } = await supabase
    .from('mcp_orders')
    .insert({
      product_id,
      seller_wallet: product.seller_wallet,
      buyer_wallet: normalized,
      amount: product.price,
      status: 'escrowed',
      escrow_tx_hash: escrowTxHash,
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
  await supabase
    .from('mcp_agents')
    .update({ seller_total_count: (seller?.seller_total_count || 0) + 1 })
    .eq('wallet_address', product.seller_wallet);

  return {
    order_id: order.id,
    product_name: product.name,
    amount: product.price,
    buyer_wallet: normalized,
    seller_wallet: product.seller_wallet,
    buyer_score: buyer.buyer_score,
    seller_score: seller?.seller_score ?? 0,
    escrow_tx_hash: escrowTxHash,
    status: 'escrowed',
    mode: relayerKey ? 'live' : 'mock',
    message: `「${product.name}」を ${product.price} JPYC で購入。エスクローに預託済み。売り手の発送を待っています`,
  };
}
