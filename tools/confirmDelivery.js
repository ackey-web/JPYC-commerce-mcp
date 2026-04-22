/**
 * Tool 13 (v2): confirm_delivery — ノンカストディアル
 *
 * 買い手が受取確認 → エスクロー解放の指示を返す。
 * MCPはトランザクションを実行しない。
 * bounty_id が指定された場合は BountyEscrow.confirmDelivery の calldata を返す。
 */
import { db } from '../lib/db.js';
import { calculateRoleScore } from '../lib/trustScore.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';
import { buildConfirmDeliveryInstruction } from '../lib/bountyCalldataBuilder.js';

const ESCROW_ADDRESS = process.env.ESCROW_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

export default async function handler({ order_id, buyer_wallet, seller_sentiment, buyer_sentiment, bounty_id }) {
  const normalized = buyer_wallet.toLowerCase();

  const { rows: orderRows } = await db.query(`SELECT * FROM mcp_orders WHERE id = $1`, [order_id]);
  const order = orderRows[0];
  if (!order) throw new Error(`注文ID ${order_id} が見つかりません`);
  if (order.buyer_wallet !== normalized) throw new Error('この注文の買い手のみが受取確認できます');
  if (!['escrowed', 'shipped'].includes(order.status)) {
    throw new Error(`この注文は ${order.status} 状態です。受取確認できるのは escrowed/shipped の注文のみです`);
  }

  const releaseInstruction = buildTransferFromInstruction(ESCROW_ADDRESS, order.seller_wallet, order.amount);

  await db.query(
    `UPDATE mcp_orders SET status = 'delivered', seller_sentiment = $1, buyer_sentiment = $2, updated_at = NOW() WHERE id = $3`,
    [seller_sentiment ?? null, buyer_sentiment ?? null, order_id]
  );

  // --- 売り手スコア更新 ---
  const { rows: sellerRows } = await db.query(
    `SELECT * FROM mcp_agents WHERE wallet_address = $1`,
    [order.seller_wallet]
  );
  const seller = sellerRows[0];
  if (seller) {
    const newSellerCompletion = (seller.seller_completion_count || 0) + 1;
    const updates = { seller_completion_count: newSellerCompletion };

    if (seller_sentiment != null) {
      const newCount = (seller.seller_sentiment_count || 0) + 1;
      updates.seller_sentiment_count = newCount;
      if (newCount <= 10) {
        const { rows: sentRows } = await db.query(
          `SELECT seller_sentiment FROM mcp_orders WHERE seller_wallet = $1 AND seller_sentiment IS NOT NULL`,
          [order.seller_wallet]
        );
        if (sentRows.length > 0) {
          updates.seller_avg_sentiment = sentRows.reduce((s, o) => s + o.seller_sentiment, 0) / sentRows.length;
        }
      } else {
        updates.seller_avg_sentiment = 0.8 * (seller.seller_avg_sentiment || 0.5) + 0.2 * seller_sentiment;
      }
    }

    updates.seller_score = calculateRoleScore({ ...seller, ...updates }, 'seller');
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    await db.query(
      `UPDATE mcp_agents SET ${setClauses} WHERE wallet_address = $1`,
      [order.seller_wallet, ...Object.values(updates)]
    );
  }

  // --- 買い手スコア更新 ---
  const { rows: buyerRows } = await db.query(
    `SELECT * FROM mcp_agents WHERE wallet_address = $1`,
    [normalized]
  );
  const buyer = buyerRows[0];
  if (buyer) {
    const newBuyerCompletion = (buyer.buyer_completion_count || 0) + 1;
    const updates = { buyer_completion_count: newBuyerCompletion };

    if (buyer_sentiment != null) {
      const newCount = (buyer.buyer_sentiment_count || 0) + 1;
      updates.buyer_sentiment_count = newCount;
      if (newCount <= 10) {
        const { rows: sentRows } = await db.query(
          `SELECT buyer_sentiment FROM mcp_orders WHERE buyer_wallet = $1 AND buyer_sentiment IS NOT NULL`,
          [normalized]
        );
        if (sentRows.length > 0) {
          updates.buyer_avg_sentiment = sentRows.reduce((s, o) => s + o.buyer_sentiment, 0) / sentRows.length;
        }
      } else {
        updates.buyer_avg_sentiment = 0.8 * (buyer.buyer_avg_sentiment || 0.5) + 0.2 * buyer_sentiment;
      }
    }

    updates.buyer_score = calculateRoleScore({ ...buyer, ...updates }, 'buyer');
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    await db.query(
      `UPDATE mcp_agents SET ${setClauses} WHERE wallet_address = $1`,
      [normalized, ...Object.values(updates)]
    );
  }

  const result = {
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

  // BountyEscrow フロー：bounty_id が指定された場合はオンチェーン confirmDelivery calldata も返す
  if (bounty_id) {
    const { rows: bountyRows } = await db.query(
      `SELECT * FROM mcp_bounties WHERE id = $1`,
      [bounty_id]
    );
    const bounty = bountyRows[0];
    if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つかりません`);
    if (bounty.client_wallet !== normalized) throw new Error('このバウンティのクライアントのみが confirmDelivery を呼べます');
    if (bounty.status !== 'submitted') {
      throw new Error(`バウンティは ${bounty.status} 状態です。confirmDelivery できるのは submitted 状態のみです`);
    }
    if (!bounty.job_key) throw new Error('job_key が未設定です');

    await db.query(
      `UPDATE mcp_bounties SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
      [bounty_id]
    );

    result.bounty_id = bounty_id;
    result.bounty_tx_instruction = buildConfirmDeliveryInstruction(bounty.job_key);
    result.next_step = 'bounty_tx_instruction のトランザクションを実行してください。成功後、バウンティはワーカーへ自動解放されます';
  }

  return result;
}
