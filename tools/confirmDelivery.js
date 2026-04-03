/**
 * Tool 13: confirm_delivery
 * 買い手が商品の受取を確認し、エスクローを解放する
 *
 * フロー:
 * 1. 注文の存在と状態を確認（escrowed or shipped）
 * 2. 買い手本人であることを確認
 * 3. エスクローから売り手にJPYCを送金
 * 4. 双方の信頼スコアを更新
 * 5. 注文を delivered → completed に更新
 */
import { supabase } from '../lib/supabase.js';
import { calculateRoleScore } from '../lib/trustScore.js';

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

  // エスクロー解放: 売り手に送金
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const escrowAddress = process.env.ESCROW_WALLET_ADDRESS;
  let releaseTxHash;

  if (relayerKey && escrowAddress) {
    const { ethers } = await import('ethers');
    const rpcUrl = process.env.VITE_ALCHEMY_RPC_URL || process.env.POLYGON_RPC_URL;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const relayerWallet = new ethers.Wallet(relayerKey, provider);

    const jpycAddress = process.env.JPYC_CONTRACT_ADDRESS || '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
    const ERC20_ABI = [
      'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    ];
    const jpyc = new ethers.Contract(jpycAddress, ERC20_ABI, relayerWallet);
    const amountWei = BigInt(order.amount) * BigInt(10 ** 18);

    const tx = await jpyc.transferFrom(escrowAddress, order.seller_wallet, amountWei, {
      maxFeePerGas: ethers.utils.parseUnits('200', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      gasLimit: 100000,
    });
    await tx.wait();
    releaseTxHash = tx.hash;
  } else {
    releaseTxHash = `mock_release_${Date.now()}`;
  }

  // 注文を completed に更新
  await supabase
    .from('mcp_orders')
    .update({
      status: 'completed',
      release_tx_hash: releaseTxHash,
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
    const updates = {
      seller_completion_count: newSellerCompletion,
    };

    // seller_sentiment（買い手が売り手を評価）
    if (seller_sentiment != null) {
      const newCount = (seller.seller_sentiment_count || 0) + 1;
      updates.seller_sentiment_count = newCount;
      if (newCount <= 10) {
        // 単純平均
        const { data: orders } = await supabase
          .from('mcp_orders')
          .select('seller_sentiment')
          .eq('seller_wallet', order.seller_wallet)
          .eq('status', 'completed')
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
    const updates = {
      buyer_completion_count: newBuyerCompletion,
    };

    // buyer_sentiment（売り手が買い手を評価）
    if (buyer_sentiment != null) {
      const newCount = (buyer.buyer_sentiment_count || 0) + 1;
      updates.buyer_sentiment_count = newCount;
      if (newCount <= 10) {
        const { data: orders } = await supabase
          .from('mcp_orders')
          .select('buyer_sentiment')
          .eq('buyer_wallet', normalized)
          .eq('status', 'completed')
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
    release_tx_hash: releaseTxHash,
    seller_score_updated: seller ? true : false,
    buyer_score_updated: buyer ? true : false,
    status: 'completed',
    message: `受取確認完了。${order.amount} JPYCを売り手にリリースしました`,
  };
}
