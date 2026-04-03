# Use Case: SaaS / Platform Integration

## Scenario

A freelance matching platform wants to add trust-based automated payments without building the scoring and payment infrastructure from scratch. They integrate JPYC Commerce MCP as their backend payment judgment layer.

```
Freelance Platform (Frontend)
      |
      v
Platform Backend (API)
      |
      +---> JPYC Commerce MCP
      |       |
      |       +-- evaluate_task: "How much should this cost?"
      |       +-- get_sbt_profile: "Can we trust this freelancer?"
      |       +-- propose_negotiation: "Fair price based on trust"
      |       +-- execute_payment: "Pay them in JPYC"
      |       +-- verify_trust_score: "Is this score legit?"
      |
      v
Polygon (JPYC transfers + Merkle Root)
```

## Integration Patterns

### Pattern 1: MCP as Microservice (stdio)

Run the MCP server as a subprocess and communicate via stdio:

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/JPYC-commerce-mcp/index.js'],
  env: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
});

const client = new Client({ name: 'my-platform', version: '1.0.0' });
await client.connect(transport);

// Now call tools
const result = await client.callTool({
  name: 'evaluate_task',
  arguments: {
    description: 'Build a landing page with React and Tailwind',
    required_skills: ['React', 'Tailwind', 'TypeScript'],
    deadline: '2026-04-15T00:00:00Z',
  },
});
```

### Pattern 2: Embed in Claude Desktop / Cursor / Windsurf

Add to your MCP config and let AI assistants use the tools directly:

```json
{
  "mcpServers": {
    "jpyc-commerce": {
      "command": "node",
      "args": ["/path/to/JPYC-commerce-mcp/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

Then in conversation:

> "Evaluate a task to build a REST API with Node.js and PostgreSQL, deadline in 2 weeks, and propose payment to agent 0xABC..."

The AI assistant calls the MCP tools automatically.

### Pattern 3: Verify Before You Trust

Before accepting a new agent on your platform:

```javascript
// Agent claims trust_score = 85
const verification = await client.callTool({
  name: 'verify_trust_score',
  arguments: { wallet_address: '0xABC...' },
});

if (verification.verification === 'verified') {
  // Score is confirmed by on-chain Merkle Root
  allowAgentOnPlatform(agentWallet);
} else {
  // Score may have been tampered with
  requireManualReview(agentWallet);
}
```

## What You Don't Have to Build

| Without JPYC Commerce MCP | With JPYC Commerce MCP |
|---|---|
| Build your own reputation system | `get_sbt_profile` + `update_agent_record` |
| Design scoring algorithms | Trust score v2 formula (battle-tested) |
| Implement payment logic | `execute_payment` (JPYC on Polygon) |
| Build approval workflows | `request_human_approval` (auto + manual) |
| Create anti-fraud measures | On-chain Merkle verification |
| Manage payment limits | `mcp_auto_payment_config` |

## Who Is This For?

- **Platform developers** who need a payment + reputation layer
- **SaaS builders** adding AI agent capabilities to their product
- **Startups** that want to launch fast without building payment infrastructure

## Pricing Model Suggestion

Since this is an MCP server, platforms can self-host it (free, bring your own Supabase) or you can offer hosted access:

| Tier | Description |
|------|-------------|
| Self-hosted | Free, MIT license, run your own instance |
| Managed | Hosted MCP endpoint, shared Merkle Root commits |
| Enterprise | Dedicated instance, custom scoring parameters, SLA |
