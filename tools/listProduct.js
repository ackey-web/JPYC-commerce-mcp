/**
 * Tool 11: list_product
 * 売り手が商品を出品する
 */
import { db } from '../lib/db.js';

export default async function handler({ seller_wallet, name, description, price, category, stock, metadata }) {
  const normalized = seller_wallet.toLowerCase();

  const { rows } = await db.query(`SELECT id, seller_score FROM mcp_agents WHERE wallet_address = $1`, [normalized]);
  let agent = rows[0] ?? null;
  if (!agent) {
    const { rows: inserted } = await db.query(
      `INSERT INTO mcp_agents (wallet_address) VALUES ($1) RETURNING id, seller_score`,
      [normalized]
    );
    agent = inserted[0];
  }

  if (price <= 0) throw new Error('price は1以上の整数（JPYC）を指定してください');
  const validCategories = ['digital', 'physical', 'nft'];
  if (category && !validCategories.includes(category)) throw new Error(`category は ${validCategories.join(' / ')} のいずれかを指定してください`);

  const { rows: productRows } = await db.query(
    `INSERT INTO mcp_products (seller_wallet, title, description, price, category, tags)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [normalized, name, description || null, price, category || 'digital', '{}']
  );
  if (!productRows[0]) throw new Error('出品失敗');

  return {
    product_id: productRows[0].id,
    seller_wallet: normalized,
    seller_score: agent.seller_score,
    name, price, category: category || 'digital',
    message: `「${name}」を ${price} JPYC で出品しました`,
  };
}
