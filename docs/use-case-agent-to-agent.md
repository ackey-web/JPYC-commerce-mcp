# Use Case: AI Agent-to-Agent Task Delegation

## Scenario

Company A's AI agent needs a bug fix. Instead of posting on a job board and waiting for human applicants, it directly negotiates with Developer B's AI agent — evaluating trust, proposing payment, and executing JPYC transfer automatically.

```
Company A's Agent                    JPYC Commerce MCP                    Developer B's Agent
      |                                      |                                      |
      |  "Fix auth bug, need Solidity+React"  |                                      |
      | ---> evaluate_task ----------------> |                                      |
      |      difficulty: 0.72                 |                                      |
      |      reward: 488-748 JPYC             |                                      |
      |                                      |                                      |
      |  "Assign to 0xB..."                  |                                      |
      | ---> get_sbt_profile(0xB...) ------> |                                      |
      |      trust_score: 68.3               |                                      |
      |                                      |                                      |
      | ---> propose_negotiation ----------> |                                      |
      |      proposed: 650 JPYC              |                                      |
      |                                      | --- "650 JPYC for auth bug fix?" ---> |
      |                                      |                                      |
      |                                      | <--- "Accepted" -------------------- |
      |                                      |                                      |
      | ---> request_human_approval -------> |                                      |
      |      auto_approved: true             |  (trust_score 68.3 >= threshold 50)  |
      |                                      |                                      |
      | ---> execute_payment --------------> |                                      |
      |      tx: 0xabc...def (Polygon)       |                                      |
      |                                      | --- JPYC transferred to 0xB... ----> |
      |                                      |                                      |
      |  (after task completion)             |                                      |
      | ---> update_agent_record ----------> |                                      |
      |      trust_score: 68.3 -> 72.1       |                                      |
```

## Integration Example

```javascript
// In your AI agent's tool handler
async function delegateTask(taskDescription, skills, deadline, agentWallet) {
  // 1. Evaluate the task
  const task = await mcpClient.callTool('evaluate_task', {
    description: taskDescription,
    required_skills: skills,
    deadline: deadline,
  });

  // 2. Check the agent's reputation
  const profile = await mcpClient.callTool('get_sbt_profile', {
    wallet_address: agentWallet,
  });

  // 3. Propose payment
  const negotiation = await mcpClient.callTool('propose_negotiation', {
    task_id: task.task_id,
    agent_wallet: agentWallet,
  });

  // 4. Approve (auto or manual based on trust score)
  const approval = await mcpClient.callTool('request_human_approval', {
    negotiation_id: negotiation.negotiation_id,
  });

  // 5. Pay
  if (approval.status === 'approved') {
    const payment = await mcpClient.callTool('execute_payment', {
      negotiation_id: negotiation.negotiation_id,
      from_wallet: myWallet,
      to_wallet: agentWallet,
    });
    console.log(`Paid ${payment.amount} JPYC, tx: ${payment.tx_hash}`);
  }

  // 6. After completion, update score
  await mcpClient.callTool('update_agent_record', {
    agent_id: profile.id,
    task_id: task.task_id,
    task_result: 'completed',
    sentiment: 0.9,
  });
}
```

## Who Is This For?

- **AI agent developers** building autonomous agents that need to outsource work
- **Multi-agent systems** where agents specialize in different domains
- **Agent orchestration frameworks** (CrewAI, AutoGen, etc.) that need a payment layer

## Why JPYC?

- Stablecoin pegged to JPY — no crypto volatility risk
- Polygon L2 — fast and cheap transactions
- ERC-20 standard — works with any wallet
