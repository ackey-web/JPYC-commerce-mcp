/**
 * Tool 12 (v2): purchase — ノンカストディアル
 * エスクロー送金のトランザクション指示を返す
 */
import { db } from '../lib/db.js';
import { buildTransferFromInstruction } from '../lib/txBuilder.js';

const ESCROW_ADDRESS = process.env.ESCROW_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

export default async function handler({ product_id, buyer_wallet }) {
  const normalized = buyer_wallet.toLowerCase();

  const { rows: prodRows } = await db.query(`SELECT * FROM mcp_products WHERE id = $1`, [product_id]);
  const product = prodRows[0];
  if (!product) throw new Error(`商品ID ${product_id} が見つかりません`);
  if (!product.active) throw new Error('この商品は現在販売停止中です');
  if (product.seller_wallet === normalized) throw new Error('自分の商品は購入できません');

  let { rows: buyerRows } = await db.query(
    `SELECT id, buyer_score, buyer_total_count FROM mcp_agents WHERE wallet_address = $1`,
    [normalized]
  );
  let buyer = buyerRows[0] ?? null;
  if (!buyer) {
    const { rows: inserted } = await db.query(
      `INSERT INTO mcp_agents (wallet_address) VALUES ($1) RETURNING id, buyer_score, buyer_total_count`,
      [normalized]
    );
    buyer = inserted[0];
  }

  const { rows: sellerRows } = await db.query(
    `SELECT seller_score, seller_total_count FROM mcp_agents WHERE wallet_address = $1`,
    [product.seller_wallet]
  );
  const seller = sellerRows[0] ?? null;

  const escrowInstruction = buildTransferFromInstruction(normalized, ESCROW_ADDRESS, product.price);

  const { rows: orderRows } = await db.query(
    `INSERT INTO mcp_orders (product_id, seller_wallet, buyer_wallet, amount, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [product_id, product.seller_wallet, normalized, product.price]
  );
  if (!orderRows[0]) throw new Error('注文作成失敗');

  await db.query(
    `UPDATE mcp_agents SET buyer_total_count = COALESCE(buyer_total_count, 0) + 1 WHERE wallet_address = $1`,
    [normalized]
  );
  await db.query(
    `UPDATE mcp_agents SET seller_total_count = COALESCE(seller_total_count, 0) + 1 WHERE wallet_address = $1`,
    [product.seller_wallet]
  );

  return {
    order_id: orderRows[0].id,
    product_name: product.title,
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
