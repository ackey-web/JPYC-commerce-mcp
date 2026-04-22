/**
 * Tool: accept_bid
 * クライアントが入札を受諾し、BountyEscrow.acceptBid の calldata を返す（ノンカストディアル）。
 * DB の mcp_bounties.status を 'assigned' に、mcp_bounty_bids.status を 'accepted' に更新。
 */
import { db } from '../lib/db.js';
import { buildAcceptBidInstruction } from '../lib/bountyCalldataBuilder.js';

export default async function handler({ bounty_id, bid_id, client_wallet }) {
  const normalized = client_wallet.toLowerCase();

  const { rows: bountyRows } = await db.query(
    `SELECT * FROM mcp_bounties WHERE id = $1`,
    [bounty_id]
  );
  const bounty = bountyRows[0];
  if (!bounty) throw new Error(`バウンティID ${bounty_id} が見つかりません`);
  if (bounty.client_wallet !== normalized) throw new Error('このバウンティのクライアントのみが入札を受諾できます');
  if (bounty.status !== 'open') {
    throw new Error(`バウンティは ${bounty.status} 状態です。受諾できるのは open 状態のバウンティのみです`);
  }

  const { rows: bidRows } = await db.query(
    `SELECT * FROM mcp_bounty_bids WHERE id = $1 AND bounty_id = $2`,
    [bid_id, bounty_id]
  );
  const bid = bidRows[0];
  if (!bid) throw new Error(`入札ID ${bid_id} がバウンティ ${bounty_id} に見つかりません`);
  if (bid.status !== 'pending') throw new Error(`入札は既に ${bid.status} 状態です`);

  if (!bounty.job_key) {
    throw new Error('job_key が未設定です。openBounty トランザクション後に report_tx_hash で job_key を登録してください');
  }
  if (!bid.onchain_bid_id) {
    throw new Error('オンチェーン bid_id が未設定です。submitBid トランザクション後に report_tx_hash で onchain_bid_id を登録してください');
  }

  // DB 更新（楽観的更新：オンチェーン確定前に状態遷移）
  await db.query(
    `UPDATE mcp_bounties SET status = 'assigned', updated_at = NOW() WHERE id = $1`,
    [bounty_id]
  );
  await db.query(
    `UPDATE mcp_bounty_bids SET status = 'accepted' WHERE id = $1`,
    [bid_id]
  );
  await db.query(
    `UPDATE mcp_bounty_bids SET status = 'rejected' WHERE bounty_id = $1 AND id != $2 AND status = 'pending'`,
    [bounty_id, bid_id]
  );

  const txInstruction = buildAcceptBidInstruction(bounty.job_key, bid.onchain_bid_id);

  return {
    bounty_id,
    bid_id,
    client_wallet: normalized,
    worker_wallet: bid.bidder_wallet,
    bid_amount: bid.bid_amount,
    job_key: bounty.job_key,
    onchain_bid_id: bid.onchain_bid_id,
    status: 'assigned',
    tx_instruction: txInstruction,
    next_step: 'tx_instruction のトランザクションを実行後、ワーカーへ作業開始を通知してください',
  };
}
