import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import getSbtProfile from './tools/getSbtProfile.js';
import evaluateTask from './tools/evaluateTask.js';
import proposeNegotiation from './tools/proposeNegotiation.js';
import requestHumanApproval from './tools/requestHumanApproval.js';
import executePayment from './tools/executePayment.js';
import updateAgentRecord from './tools/updateSbtRecord.js';

const server = new McpServer({
  name: 'gifterra-commerce-mcp',
  version: '2.0.0',
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
  'タスクIDとエージェントウォレットを受け取り、trust_scoreに基づいた報酬交渉案を提案する',
  {
    task_id: z.string().describe('evaluate_task で発行されたタスクID'),
    agent_wallet: z.string().describe('タスクを担当するエージェントのウォレットアドレス'),
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

// StdioServerTransport で起動
const transport = new StdioServerTransport();
await server.connect(transport);
