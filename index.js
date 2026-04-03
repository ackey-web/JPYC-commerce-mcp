import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import getSbtProfile from './tools/getSbtProfile.js';
import evaluateTask from './tools/evaluateTask.js';
import proposeNegotiation from './tools/proposeNegotiation.js';
import requestHumanApproval from './tools/requestHumanApproval.js';
import executePayment from './tools/executePayment.js';
import updateAgentRecord from './tools/updateSbtRecord.js';
import verifyTrustScore from './tools/verifyTrustScore.js';
import submitBid from './tools/submitBid.js';
import respondToOffer from './tools/respondToOffer.js';
import setRateCard from './tools/setRateCard.js';
import listProduct from './tools/listProduct.js';
import purchase from './tools/purchase.js';
import confirmDelivery from './tools/confirmDelivery.js';

const server = new McpServer({
  name: 'gifterra-commerce-mcp',
  version: '4.0.0',
});

// Tool 1: get_sbt_profile
server.tool(
  'get_sbt_profile',
  'ウォレットアドレスに紐づくエージェントプロフィール（信頼スコア・完遂数・評価）を取得する',
  {
    wallet_address: z.string().describe('対象のウォレットアドレス'),
  },
  async (args) => {
    const result = await getSbtProfile(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 2: evaluate_task
server.tool(
  'evaluate_task',
  'タスクの説明・必要スキル・期限から難易度スコアと推奨報酬レンジを評価する',
  {
    description: z.string().describe('タスクの説明'),
    required_skills: z.array(z.string()).describe('必要なスキルのリスト'),
    deadline: z.string().describe('期限（ISO 8601形式、例: 2026-04-10T00:00:00Z）'),
  },
  async (args) => {
    const result = await evaluateTask(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 3: propose_negotiation
server.tool(
  'propose_negotiation',
  'タスクIDとエージェントウォレットを受け取り、trust_score（+入札額）に基づいた報酬交渉案を提案する。bid_id指定で入札ベースの交渉、カウンターオファーへの再提案にも対応',
  {
    task_id: z.string().describe('evaluate_task で発行されたタスクID'),
    agent_wallet: z.string().describe('タスクを担当するエージェントのウォレットアドレス'),
    bid_id: z.string().optional().describe('submit_bid で発行された入札ID（入札ベースの交渉時に指定）'),
  },
  async (args) => {
    const result = await proposeNegotiation(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 4: request_human_approval
server.tool(
  'request_human_approval',
  '交渉IDを人間に提示し、承認（approved）または却下（rejected）を待つ',
  {
    negotiation_id: z.string().describe('propose_negotiation で発行された交渉ID'),
  },
  async (args) => {
    const result = await requestHumanApproval(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 5: execute_payment
server.tool(
  'execute_payment',
  '承認済み交渉に基づいてオンチェーン送金を実行し、支払いIDとトランザクションハッシュを返す',
  {
    negotiation_id: z.string().describe('承認済みの交渉ID'),
    from_wallet: z.string().describe('送金元ウォレットアドレス'),
    to_wallet: z.string().describe('送金先ウォレットアドレス'),
  },
  async (args) => {
    const result = await executePayment(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 6: update_agent_record（旧 update_sbt_record）
server.tool(
  'update_agent_record',
  'タスク完了後にエージェントの信頼スコア（trust_score）を更新する',
  {
    agent_id: z.string().describe('エージェントID（UUID）'),
    task_id: z.string().describe('タスクID（UUID）'),
    task_result: z.enum([
      'completed', 'failed', 'timeout',
      'cancelled_by_client', 'cancelled_by_agent',
    ]).describe('タスクの結果'),
    sentiment: z.number().min(0).max(1).optional().describe(
      '発注側からの評価（0.0〜1.0）。completedの場合は必須'
    ),
  },
  async (args) => {
    const result = await updateAgentRecord(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 7: verify_trust_score
server.tool(
  'verify_trust_score',
  'エージェントの信頼スコアをオンチェーンMerkle Rootで検証する',
  {
    wallet_address: z.string().describe('検証対象のウォレットアドレス'),
  },
  async (args) => {
    const result = await verifyTrustScore(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 8: submit_bid
server.tool(
  'submit_bid',
  '受注側エージェントがタスクに対して希望報酬額（見積もり）を提示する',
  {
    task_id: z.string().describe('入札対象のタスクID'),
    agent_wallet: z.string().describe('受注側エージェントのウォレットアドレス'),
    bid_amount: z.number().int().positive().describe('希望報酬額（JPYC）'),
    message: z.string().optional().describe('入札メッセージ（実績アピール等）'),
  },
  async (args) => {
    const result = await submitBid(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 9: respond_to_offer
server.tool(
  'respond_to_offer',
  '受注側エージェントが発注側の交渉提案に対して受諾・拒否・カウンターオファーで応答する',
  {
    negotiation_id: z.string().describe('応答対象の交渉ID'),
    response: z.enum(['accepted', 'rejected', 'countered']).describe('応答タイプ'),
    counter_amount: z.number().int().positive().optional().describe('カウンターオファー額（JPYC）。countered の場合は必須'),
    message: z.string().optional().describe('応答メッセージ'),
  },
  async (args) => {
    const result = await respondToOffer(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 10: set_rate_card
server.tool(
  'set_rate_card',
  'エージェントオーナー（人間）がスキル別の希望単価と入札上限を事前設定する。エージェントはこの範囲内でしか入札できない',
  {
    agent_wallet: z.string().describe('設定対象のエージェントウォレットアドレス'),
    rates: z.array(z.object({
      skill: z.string().describe('スキル名（例: Solidity, React）'),
      rate_per_task: z.number().int().positive().describe('1タスクあたりの希望単価（JPYC）'),
      min_acceptable: z.number().int().positive().optional().describe('これ以下の提案は自動拒否の参考値（JPYC）'),
    })).describe('スキル別料金の配列'),
    auto_bid_enabled: z.boolean().optional().describe('rate_cardに基づく自動入札を有効にするか'),
    max_bid_amount: z.number().int().positive().optional().describe('1回の入札の上限額（JPYC）。デフォルト1000'),
  },
  async (args) => {
    const result = await setRateCard(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

// Tool 11: list_product
server.tool(
  'list_product',
  '売り手が商品を出品する（固定価格）',
  {
    seller_wallet: z.string().describe('売り手のウォレットアドレス'),
    name: z.string().describe('商品名'),
    description: z.string().optional().describe('商品説明'),
    price: z.number().int().positive().describe('価格（JPYC）'),
    category: z.enum(['digital', 'physical', 'nft']).optional().describe('カテゴリ（デフォルト: digital）'),
    stock: z.number().int().optional().describe('在庫数（デフォルト: 1、-1で無限）'),
    metadata: z.record(z.any()).optional().describe('追加情報（画像URL等）'),
  },
  async (args) => {
    const result = await listProduct(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Tool 12: purchase
server.tool(
  'purchase',
  '買い手が商品を購入する。JPYCをエスクローに預託し、受取確認後に売り手へリリース',
  {
    product_id: z.string().describe('購入する商品ID'),
    buyer_wallet: z.string().describe('買い手のウォレットアドレス'),
  },
  async (args) => {
    const result = await purchase(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Tool 13: confirm_delivery
server.tool(
  'confirm_delivery',
  '買い手が商品の受取を確認し、エスクローから売り手にJPYCをリリースする。双方の信頼スコアを更新',
  {
    order_id: z.string().describe('注文ID'),
    buyer_wallet: z.string().describe('買い手のウォレットアドレス（本人確認）'),
    seller_sentiment: z.number().min(0).max(1).optional().describe('買い手→売り手の評価（0.0〜1.0）'),
    buyer_sentiment: z.number().min(0).max(1).optional().describe('売り手→買い手の評価（0.0〜1.0）'),
  },
  async (args) => {
    const result = await confirmDelivery(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// StdioServerTransport で起動
const transport = new StdioServerTransport();
await server.connect(transport);
