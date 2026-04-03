# JPYC Commerce MCP

A Model Context Protocol (MCP) server for AI agent commerce — task evaluation, trust-based negotiation, and JPYC payment execution on Polygon.

## Features

- **Trust Score System** — Multi-axis agent reputation (volume x reliability x longevity x reputation x failure decay)
- **AI-Enhanced Task Evaluation** — Claude API analyzes task complexity with skill-weighted scoring
- **Auto-Payment** — Trust score-gated automatic JPYC transfers with daily limits
- **Human-in-the-Loop** — Fallback to manual approval when auto-payment conditions aren't met

## Tools

| Tool | Description |
|------|-------------|
| `get_sbt_profile` | Get agent trust profile (score, completion stats, sentiment) |
| `evaluate_task` | Assess task difficulty and recommend reward range |
| `propose_negotiation` | Generate trust-score-based payment proposal |
| `request_human_approval` | Approve negotiation (auto or manual) |
| `execute_payment` | Execute JPYC transfer on Polygon (or mock) |
| `update_agent_record` | Update trust score after task completion |

## Quick Start

```bash
npm install
```

### Environment Variables

```bash
# Required: Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional: AI-enhanced evaluation
ANTHROPIC_API_KEY=your_anthropic_key

# Optional: Live JPYC transfer on Polygon
RELAYER_PRIVATE_KEY=your_relayer_key
POLYGON_RPC_URL=your_rpc_url
JPYC_CONTRACT_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
```

### Run as MCP Server

```bash
node index.js
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "jpyc-commerce": {
      "command": "node",
      "args": ["/path/to/JPYC-commerce-mcp/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "..."
      }
    }
  }
}
```

## Trust Score Formula

```
trust_score = volume x reliability x longevity x reputation x failure_decay

volume        = 10 x log2(1 + completion_count)
reliability   = smoothed_rate^2  (Laplace smoothing)
longevity     = 1 + 0.5 x log2(1 + active_months)
reputation    = 0.5 + 0.5 x avg_sentiment
failure_decay = max(0.1, 1 - recent_failure_rate)
```

## Auto-Payment Conditions

All must be true:
1. Platform auto-payment is enabled
2. Agent has opted in (`auto_payment_enabled = true`)
3. `trust_score >= auto_payment_threshold` (default: 50)
4. Amount <= `auto_payment_limit` (default: 500 JPYC)
5. Daily transaction count < limit (default: 10/day)

## License

MIT

## Patent Notice

Patent pending
