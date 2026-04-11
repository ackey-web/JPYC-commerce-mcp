# JPYC Commerce MCP

A Model Context Protocol (MCP) server for AI agent commerce — task evaluation, trust-based negotiation, and **non-custodial** JPYC payment instructions on Polygon.

## Features

- **Non-Custodial by Design** — The MCP server never holds private keys. `execute_payment` returns transaction instructions (calldata); the caller signs and submits with their own wallet and gas.
- **Trust Score System** — Multi-axis agent reputation (volume x reliability x longevity x reputation x failure decay)
- **On-Chain Verification** — Merkle Root committed to Polygon; any agent can verify scores with Merkle Proof
- **AI-Enhanced Task Evaluation** — Claude API analyzes task complexity with skill-weighted scoring
- **Human-Controlled Pricing** — Owners set rate cards; agents cannot bid outside pre-approved ranges
- **Bidirectional Negotiation** — Agents bid, clients counter, multi-round concession until agreement
- **Auto-Approval** — Trust score-gated automatic approval of negotiations (no human prompt), with daily limits
- **Human-in-the-Loop** — Fallback to manual approval when auto-approval conditions aren't met

## Use Cases

| Scenario | Description | Guide |
|----------|-------------|-------|
| **Agent-to-Agent** | AI agents autonomously delegate tasks and pay each other | [docs/use-case-agent-to-agent.md](docs/use-case-agent-to-agent.md) |
| **DAO / Community** | Transparent, trust-based contributor payments for DAOs | [docs/use-case-dao.md](docs/use-case-dao.md) |
| **Platform Integration** | Add reputation + payment layer to your SaaS | [docs/use-case-platform.md](docs/use-case-platform.md) |
| **Demo Walkthrough** | Step-by-step guide to run and understand the demo | [docs/demo-walkthrough.md](docs/demo-walkthrough.md) |

## Architecture

```
Human owner sets rate card --> Agent bids within limits --> Negotiation --> Payment

Trust scores:
  Off-chain (Supabase)  -->  Merkle Root on Polygon  -->  Verifiable by anyone
```

Only the **client (task creator)** needs to install this MCP. Agents just need a wallet to receive JPYC.

## Tools (10 tools)

### Setup (Human / Owner)

| Tool | Description |
|------|-------------|
| `set_rate_card` | **Owner** pre-sets skill-based rates and bid limits. Agents cannot exceed these. |

### Core Flow

| Tool | Side | Description |
|------|------|-------------|
| `get_sbt_profile` | Both | Get agent trust profile (score, completion stats, sentiment) |
| `evaluate_task` | Client | Assess task difficulty and recommend reward range (AI-enhanced) |
| `submit_bid` | Agent | Bid on a task (auto-calculated from rate card, or manual within limits) |
| `propose_negotiation` | Client | Generate payment proposal based on trust score + bid |
| `respond_to_offer` | Agent | Accept, reject, or counter the proposal |
| `request_human_approval` | Client | Approve negotiation (auto or manual based on trust score) |
| `execute_payment` | Client | Return JPYC `transferFrom` calldata for the caller to sign and submit (non-custodial) |
| `report_tx_hash` | Client | Report the submitted tx hash back to the MCP after the caller broadcasts the tx |
| `update_agent_record` | Client | Update trust score after task completion |

### Verification

| Tool | Side | Description |
|------|------|-------------|
| `verify_trust_score` | Both | Verify score against on-chain Merkle Root |

### Pricing Safety Model

Agents do NOT decide their own prices. Humans control pricing through rate cards:

```
Human (Owner)                       Agent
  |                                   |
  |-- set_rate_card ----------------->|
  |   "Solidity: 800, React: 400"    |  <-- Human decides rates
  |   "max_bid: 1000 JPYC"           |  <-- Human sets ceiling
  |                                   |
  |                                   |-- submit_bid (task arrives)
  |                                   |   rate_card lookup -> 800 JPYC
  |                                   |   OK (under max_bid)
  |                                   |
  |                                   |-- submit_bid (bid: 2000 JPYC)
  |                                   |   ERROR: exceeds max_bid 1000
  |                                   |
  |                                   |-- submit_bid (no rate_card set)
  |                                   |   ERROR: owner must set rates first
```

- `rate_per_task`: desired price per skill (highest matching skill = bid amount)
- `min_acceptable`: reject offers below this (advisory)
- `max_bid_amount`: hard ceiling on any bid
- `auto_bid_enabled`: allow rate_card-based automatic bidding

### Negotiation Flow

```
Client                          MCP                             Agent
  |                              |                                |
  |-- evaluate_task ------------>|                                |
  |<-- difficulty + reward range |                                |
  |                              |                                |
  |                              |<--------- submit_bid ---------|
  |                              |   bid: 800 (from rate_card)    |
  |                              |                                |
  |-- propose_negotiation ------>|                                |
  |   (with bid_id)              |                                |
  |<-- proposed: 680 JPYC       |  (trust_score adjusts amount)  |
  |                              |                                |
  |                              |<------ respond_to_offer ------|
  |                              |   countered: 750 JPYC         |
  |                              |                                |
  |-- propose_negotiation ------>|  (round 2, concession)        |
  |<-- proposed: 720 JPYC       |                                |
  |                              |                                |
  |                              |<------ respond_to_offer ------|
  |                              |   accepted                    |
  |                              |                                |
  |-- execute_payment ---------->|                                |
  |<-- tx instruction (calldata) |                                |
  |                              |                                |
  | [Caller signs & submits tx on Polygon with own wallet/gas]    |
  |                              |                                |
  |-- report_tx_hash ----------->|                                |
  |-- update_agent_record ------>|  trust_score updated           |
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

# Optional: On-chain Merkle Root commit (for scripts/commitMerkleRoot.js only)
# The MCP server itself NEVER uses these keys. They are only needed if you
# run the periodic batch script that commits trust-score Merkle Roots to
# the on-chain TrustScoreRegistry contract on Polygon. Each installer sets
# their own key; there is no shared/fixed relayer wallet.
POLYGON_RPC_URL=your_rpc_url
TRUST_SCORE_REGISTRY_ADDRESS=your_registry_address
PRIVATE_KEY=your_private_key_for_merkle_commits
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

## Auto-Approval Conditions

The MCP does **not** execute transactions. "Auto-approval" means `request_human_approval` returns `approved` without prompting a human, so the caller can proceed to `execute_payment` (which still only returns calldata — the caller always signs and submits themselves).

All must be true:
1. Platform auto-approval is enabled
2. Agent has opted in (`auto_payment_enabled = true`)
3. `trust_score >= auto_payment_threshold` (default: 50)
4. Amount <= `auto_payment_limit` (default: 500 JPYC)
5. Daily approval count < limit (default: 10/day)

When conditions are not met, falls back to manual human approval.

## Non-Custodial Architecture

This MCP never holds private keys and never broadcasts transactions. There is no shared relayer wallet.

```
execute_payment  →  returns { to, data, value, gasEstimate, decoded }
                       ↓
                 Caller signs with their own wallet
                       ↓
                 Caller submits to Polygon, pays their own gas
                       ↓
                 Caller reports the tx hash back via report_tx_hash
```

**Why this matters:**
- **No single point of failure** — no centralized wallet that can be drained by griefing attacks
- **No regulatory exposure for MCP operators** — you're providing a tool, not moving other people's funds
- **Each installer is independent** — no need to provision or monitor a relayer wallet to run the MCP
- **Gas accountability is clear** — whoever sends the tx pays for it

If your application needs gasless UX (e.g., end users without MATIC), build that layer **on top of** this MCP — wrap `execute_payment`'s calldata with your own meta-transaction / sponsorship logic in your application server. Keeping that out of the MCP core means every installer stays in control of their own policies and risk.

## Database Schema

| Table | Purpose |
|-------|---------|
| `mcp_agents` | Agent profiles, trust scores, auto-payment/bid settings |
| `mcp_tasks` | Task evaluations and difficulty scores |
| `mcp_bids` | Agent bids (amount, status, linked to rate card) |
| `mcp_rate_cards` | Owner-set skill-based pricing (rate + min_acceptable) |
| `mcp_negotiations` | Multi-round negotiation history |
| `mcp_payments` | Payment records with tx hashes |
| `mcp_task_results` | Task outcome history (feeds trust score calculation) |
| `mcp_trust_snapshots` | Merkle Root commit history |
| `mcp_auto_payment_config` | Platform-wide payment limits |

## License

MIT

## Patent Notice

Patent pending
