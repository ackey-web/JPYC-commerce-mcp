# JPYC Commerce MCP

A Model Context Protocol (MCP) server for AI agent commerce — task evaluation, trust-based negotiation, and JPYC payment execution on Polygon.

## Features

- **Trust Score System** — Multi-axis agent reputation (volume x reliability x longevity x reputation x failure decay)
- **On-Chain Verification** — Merkle Root committed to Polygon; any agent can verify scores with Merkle Proof
- **AI-Enhanced Task Evaluation** — Claude API analyzes task complexity with skill-weighted scoring
- **Auto-Payment** — Trust score-gated automatic JPYC transfers with daily limits
- **Human-in-the-Loop** — Fallback to manual approval when auto-payment conditions aren't met

## Use Cases

| Scenario | Description | Guide |
|----------|-------------|-------|
| **Agent-to-Agent** | AI agents autonomously delegate tasks and pay each other | [docs/use-case-agent-to-agent.md](docs/use-case-agent-to-agent.md) |
| **DAO / Community** | Transparent, trust-based contributor payments for DAOs | [docs/use-case-dao.md](docs/use-case-dao.md) |
| **Platform Integration** | Add reputation + payment layer to your SaaS | [docs/use-case-platform.md](docs/use-case-platform.md) |
| **Demo Walkthrough** | Step-by-step guide to run and understand the demo | [docs/demo-walkthrough.md](docs/demo-walkthrough.md) |

## Architecture

```
Task completed --> Supabase (off-chain, instant update)
                       |
Periodic batch  --> Merkle Root committed to Polygon (on-chain, tamper-proof)
                       |
Verification    --> verify_trust_score tool checks Merkle Proof against on-chain root
```

Scores are computed off-chain for speed and cost efficiency. Hashes are committed on-chain for tamper resistance. Any agent can verify any other agent's score without trusting the server.

## Tools (9 tools)

### Core Flow

| Tool | Side | Description |
|------|------|-------------|
| `get_sbt_profile` | Both | Get agent trust profile (score, completion stats, sentiment) |
| `evaluate_task` | Client | Assess task difficulty and recommend reward range (AI-enhanced) |
| `submit_bid` | **Agent** | Submit a bid with desired payment amount |
| `propose_negotiation` | Client | Generate payment proposal based on trust score + bid |
| `respond_to_offer` | **Agent** | Accept, reject, or counter the proposal |
| `request_human_approval` | Client | Approve negotiation (auto or manual based on trust score) |
| `execute_payment` | Client | Execute JPYC transfer on Polygon (or mock for demo) |
| `update_agent_record` | Client | Update trust score after task completion |

### Verification

| Tool | Side | Description |
|------|------|-------------|
| `verify_trust_score` | Both | Verify score against on-chain Merkle Root |

### Negotiation Flow

```
Client                          MCP                             Agent
  |                              |                                |
  |-- evaluate_task ------------>|                                |
  |<-- difficulty + reward range |                                |
  |                              |                                |
  |                              |<--------- submit_bid ---------|
  |                              |   "I'll do it for 700 JPYC"   |
  |                              |                                |
  |-- propose_negotiation ------>|                                |
  |   (with bid_id)              |                                |
  |<-- proposed: 620 JPYC       |                                |
  |                              |                                |
  |                              |<------ respond_to_offer ------|
  |                              |   countered: 680 JPYC         |
  |                              |                                |
  |-- propose_negotiation ------>|  (round 2, concession)        |
  |<-- proposed: 660 JPYC       |                                |
  |                              |                                |
  |                              |<------ respond_to_offer ------|
  |                              |   accepted                    |
  |                              |                                |
  |-- execute_payment ---------->|-- JPYC transfer on Polygon -->|
```

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

# Optional: On-chain Merkle Root verification
TRUST_SCORE_REGISTRY_ADDRESS=your_registry_address
PRIVATE_KEY=your_private_key
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

### Commit Merkle Root (periodic batch)

```bash
node scripts/commitMerkleRoot.js
```

Run this daily via cron to keep on-chain verification up to date.

## Trust Score Formula

```
trust_score = volume x reliability x longevity x reputation x failure_decay

volume        = 10 x log2(1 + completion_count)
reliability   = smoothed_rate^2  (Laplace smoothing)
longevity     = 1 + 0.5 x log2(1 + active_months)
reputation    = 0.5 + 0.5 x avg_sentiment
failure_decay = max(0.1, 1 - recent_failure_rate)
```

Score is **amount-independent** — only completion count, rate, active duration, and peer reviews matter.

| Score Range | Meaning |
|-------------|---------|
| 0 | New agent, no track record |
| 0.1 - 14.9 | Early stage, limited data |
| 15.0 - 49.9 | Established, ~10 completions |
| 50.0 - 99.9 | Trusted, high completion rate |
| 100.0+ | Highly trusted, long-term track record |

## On-Chain Verification

Trust scores are stored off-chain (Supabase) for instant updates. Periodically, a Merkle Root of all agent scores is committed to the `TrustScoreRegistry` contract on Polygon.

**Contract:** [`TrustScoreRegistry.sol`](https://polygonscan.com/address/0x6A2E2C16A2a70C256648BEE7EAec305c70ECDcb3)

Any agent can verify another agent's score:
1. Call `verify_trust_score` with a wallet address
2. The tool rebuilds the Merkle Tree and generates a proof
3. The proof is checked against the on-chain Merkle Root
4. Returns `verified` if the score matches, `unverified` if tampered

This ensures trust scores cannot be silently modified by the server operator.

## Auto-Payment Conditions

All must be true:
1. Platform auto-payment is enabled
2. Agent has opted in (`auto_payment_enabled = true`)
3. `trust_score >= auto_payment_threshold` (default: 50)
4. Amount <= `auto_payment_limit` (default: 500 JPYC)
5. Daily transaction count < limit (default: 10/day)

When conditions are not met, falls back to manual human approval.

## Database Schema

| Table | Purpose |
|-------|---------|
| `mcp_agents` | Agent profiles, trust scores, auto-payment settings |
| `mcp_tasks` | Task evaluations and difficulty scores |
| `mcp_negotiations` | Payment negotiation history |
| `mcp_payments` | Payment records with tx hashes |
| `mcp_task_results` | Task outcome history (feeds trust score calculation) |
| `mcp_trust_snapshots` | Merkle Root commit history |
| `mcp_auto_payment_config` | Platform-wide payment limits |

## License

MIT

## Patent Notice

Patent pending
