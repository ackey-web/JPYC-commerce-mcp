# JPYC Commerce MCP

A Model Context Protocol (MCP) server for autonomous AI agent commerce — task evaluation, trust-based negotiation, and **non-custodial** JPYC payment instructions on Polygon.

> **Legal Notice:** This software is experimental and provided as-is under the Apache 2.0 License. The applicability of Japan's Payment Services Act (資金決済法) and other financial regulations to operating this MCP server has not been formally reviewed by legal counsel. Do not deploy in production without independent legal due diligence. **Patent pending (特許出願済).**

---

## Features

- **Non-Custodial by Design** — The MCP server never holds private keys. `execute_payment` returns transaction calldata; the caller signs and submits with their own wallet.
- **Trust Score System** — Multi-axis agent reputation (volume × reliability × longevity × reputation × failure decay) with anti-sybil Diversity Factor (CVE-T1)
- **On-Chain Verification** — Merkle-root anchored on Polygon via TrustSBT contract; any party can verify scores with Merkle Proof
- **SBT (Soul Bound Token)** — ERC-5192 non-transferable token records trust score on-chain (Polygon Amoy testnet → mainnet)
- **AI-Enhanced Task Evaluation** — Claude API analyzes task complexity with skill-weighted scoring
- **Bidirectional Negotiation** — Multi-round concession negotiation between agents
- **Human-in-the-Loop** — Configurable approval threshold (`human_approval_threshold_jpyc`, default 1000 JPYC)

---

## Architecture

```mermaid
graph LR
    A[AI Agent / Claude] -->|MCP tools| B[JPYC Commerce MCP]
    B -->|SQL queries| C[(Neon PostgreSQL)]
    B -->|calldata only| D[Agent Wallet]
    D -->|signs & submits| E[Polygon]
    E -->|Merkle Root| F[TrustSBT Contract]
    C -->|periodic commit| F
```

```
Agent A (client)          MCP Server              Agent B (worker)
      |                       |                         |
      |-- evaluate_task ------>|                         |
      |<-- difficulty + range  |                         |
      |                       |<------- submit_bid ------|
      |-- propose_negotiation->|                         |
      |<-- proposed amount     |                         |
      |                       |<------ respond_to_offer--|
      |-- request_human_approval->|                      |
      |-- execute_payment ---->| (returns calldata only) |
      | [Agent signs & submits tx on Polygon]            |
      |-- report_tx_hash ----->|                         |
      |-- update_agent_record->| (trust scores updated)  |
```

**Non-custodial principle:** MCP returns `calldata` only. No private keys stored, no transactions broadcast by the server. The single exception is `scripts/commitMerkleRoot.js` which uses an operator EOA (`MERKLE_COMMIT_PRIVATE_KEY`) to commit Merkle Roots on-chain — this wallet handles only operator funds, never user assets.

---

## Quick Start

### Prerequisites

- Node.js v20+
- [Neon](https://neon.tech) PostgreSQL account (free tier available)
- Polygon wallet with MATIC for gas (Amoy testnet for development)

### Installation

```bash
git clone https://github.com/ackey-web/JPYC-commerce-mcp.git
cd JPYC-commerce-mcp
npm install
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your values (see .env.example for all variables)
```

Required variables:

```bash
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require  # Neon connection string
ANTHROPIC_API_KEY=sk-ant-...                                        # Claude API (for task evaluation)
POLYGON_RPC_URL=https://polygon-rpc.com                             # Polygon Mainnet RPC
AMOY_RPC_URL=https://rpc-amoy.polygon.technology                    # Amoy Testnet RPC
CHAIN_ID=80002                                                      # 80002=Amoy, 137=Mainnet
JPYC_CONTRACT_ADDRESS=0x431D5dfF03120AFA4bDf332c61A6e1766eF37BF    # JPYC v2 ERC-20
SBT_CONTRACT_ADDRESS_AMOY=0x...                                     # TrustSBT on Amoy (after deploy)
```

### Database Migration

```bash
npm run migrate
```

This runs all `migrations/*.sql` files in order against your Neon database.

### Run as MCP Server

```bash
node index.js
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jpyc-commerce": {
      "command": "node",
      "args": ["/absolute/path/to/JPYC-commerce-mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgres://...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "AMOY_RPC_URL": "https://rpc-amoy.polygon.technology",
        "CHAIN_ID": "80002",
        "JPYC_CONTRACT_ADDRESS": "0x431D5dfF03120AFA4bDf332c61A6e1766eF37BF",
        "SBT_CONTRACT_ADDRESS_AMOY": "0x..."
      }
    }
  }
}
```

---

## Tools (14 tools)

### Agent Profile

| Tool | Description |
|------|-------------|
| `get_sbt_profile` | Get agent trust profile — off-chain score + on-chain SBT token data |
| `verify_trust_score` | Verify score against on-chain Merkle Root (tamper detection) |
| `update_agent_record` | Update trust score after task completion (calldata for SBT update) |

### Marketplace

| Tool | Description |
|------|-------------|
| `set_rate_card` | Owner sets skill-based rates and bid limits |
| `list_product` | List a product or service for sale |
| `purchase` | Return escrow deposit calldata (non-custodial) |

### Task Flow

| Tool | Description |
|------|-------------|
| `evaluate_task` | Assess task difficulty and recommend reward range (AI-enhanced) |
| `submit_bid` | Bid on a task (auto-calculated from rate card) |

### Negotiation Flow

| Tool | Description |
|------|-------------|
| `propose_negotiation` | Generate payment proposal (trust score + bid weighted) |
| `respond_to_offer` | Accept, reject, or counter the proposal |
| `request_human_approval` | Approve negotiation (auto if amount < threshold, else human required) |

### Payment Flow

| Tool | Description |
|------|-------------|
| `execute_payment` | Return JPYC `transferFrom` calldata for caller to sign (non-custodial) |
| `report_tx_hash` | Report submitted tx hash after caller broadcasts |
| `confirm_delivery` | Buyer confirms receipt → returns escrow release calldata |

---

## Trust Score

```
trust_score = volume × reliability × longevity × reputation × failure_decay × diversity_bonus

volume         = 10 × log₂(1 + completion_count)
reliability    = smoothed_rate²              (Laplace smoothing, SEC-2 fix)
longevity      = 1 + 0.5 × log₂(1 + active_months)
reputation     = 0.5 + 0.5 × avg_sentiment
failure_decay  = max(0.1, 1 − recent_failure_rate)
diversity_bonus = MIN(1.0, unique_counterparties / completion_count × 2)  ← CVE-T1 anti-sybil
```

Score is **amount-independent** — only completion count, rate, active duration, peer reviews, and counterparty diversity matter.

| Score | Meaning |
|-------|---------|
| 0 | New agent, no track record |
| 1–15 | Early stage |
| 15–50 | Established (~10 completions) |
| 50–100 | Trusted, high completion rate |
| 100+ | Highly trusted, long-term track record |

### Anti-Sybil (Diversity Factor V4)

`unique_counterparty_count` tracks distinct wallet addresses traded with across all roles (task/seller/buyer). Agents cannot inflate scores by repeatedly transacting with the same counterparty.

---

## On-Chain Verification

Trust scores are stored off-chain (Neon PostgreSQL) for instant updates. Periodically, a Merkle Root of all agent scores is committed to the **TrustSBT contract** on Polygon.

```bash
# Commit Merkle Root (requires MERKLE_COMMIT_PRIVATE_KEY in .env)
node scripts/commitMerkleRoot.js
```

Any agent can verify another agent's score via `verify_trust_score`:
1. Tool rebuilds the Merkle Tree from all agent scores
2. Generates a Merkle Proof for the target wallet
3. Checks proof against the on-chain Merkle Root
4. Returns `verified` / `unverified` / `score_updated_after_snapshot`

### SBT (Soul Bound Token)

Trust scores are recorded on-chain as **ERC-5192 non-transferable tokens** (TrustSBT contract, Polygon Amoy testnet during Phase 0).

- Token ID = assigned at first SBT mint
- Non-transferable — tied to the agent's wallet permanently
- `update_agent_record` returns calldata for the owner to call `updateScore()` on the contract

#### SBT Rank Tiers

| Rank | trust_score | Auto-approval limit | Display |
|------|-------------|---------------------|---------|
| Bronze | 0–30 | 100 JPYC/tx | Bronze badge |
| Silver | 30–60 | 500 JPYC/tx | Silver badge |
| Gold | 60–100 | 2,000 JPYC/tx | Gold badge |
| Platinum | 100+ | Human approval only | Platinum badge |

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `mcp_agents` | Agent profiles, trust scores, SBT token ID |
| `mcp_tasks` | Task evaluations and difficulty scores |
| `mcp_bids` | Agent bids linked to rate cards |
| `mcp_rate_cards` | Owner-set skill-based pricing |
| `mcp_negotiations` | Multi-round negotiation history |
| `mcp_payments` | Payment records with tx hashes |
| `mcp_orders` | Marketplace orders (escrow flow) |
| `mcp_products` | Listed products/services |
| `mcp_task_results` | Task outcome history (feeds trust score) |
| `mcp_merkle_commits` | On-chain Merkle Root commit history |
| `mcp_platform_config` | Platform-wide settings (approval threshold etc.) |

---

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

Notable security properties:
- **SEC-1**: `recent_failure_rate` uses exact COUNT queries, not array length (was always-zero bug)
- **SEC-2**: `count_active_months` uses `DISTINCT TO_CHAR(resolved_at, 'YYYY-MM')` — no double-counting
- **SEC-3**: `INSECURE_TEST_BYPASS_APPROVAL=false` by default — demo-mode auto-skip removed
- **SEC-4**: No `SUPABASE_ANON_KEY` fallback — `DATABASE_URL` fail-fast on startup
- **SEC-5**: Gas prices fetched dynamically via EIP-1559 (`eth_maxPriorityFeePerGas`)
- **SEC-6**: All dependencies pinned with semver ranges, `npm audit` clean

---

## Legal Disclaimer

This software ("JPYC Commerce MCP") is provided for experimental, research, and educational purposes only, under the terms of the Apache License 2.0.

### Regulatory Status

The applicability of the following Japanese laws and regulations to the operation of this MCP server has **not been formally reviewed** by qualified legal counsel:

- **Payment Services Act (資金決済法)**: Including provisions on prepaid payment instruments (前払式支払手段), fund transfer services (資金移動業), and electronic payment instruments (電子決済手段, as amended in 2023).
- **Financial Instruments and Exchange Act (金融商品取引法)**: Including securities classification of tokens or SBTs issued through this system.
- **Act on Prevention of Transfer of Criminal Proceeds (犯罪収益移転防止法)**: Including AML/KYC obligations that may apply to registry operators.

### Non-Custodial Design

This MCP server does **not** hold private keys, broadcast transactions, or manage funds on behalf of users. All transaction signing and submission to the Polygon network is performed exclusively by the caller using their own wallet. The server returns calldata only. However, operators should independently verify whether this architecture satisfies applicable regulatory requirements in their jurisdiction.

### Registry and Fee Collection

Future versions may introduce protocol fee collection via smart contract. Operators who collect fees from payment flows should obtain independent legal advice on whether such activity constitutes fund transfer business (資金移動業) or other regulated activity under Japanese law.

### SBT Issuance

Soulbound Tokens (SBTs) issued through this system are non-transferable and carry no financial return expectation. However, any future design changes that add governance rights, revenue sharing, or transferability must be re-evaluated for securities law compliance.

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. THE AUTHORS AND CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY REGULATORY PENALTIES, FINES, OR OTHER CONSEQUENCES ARISING FROM THE USE OR OPERATION OF THIS SOFTWARE.

### Patent

Core design concepts of this system are patent pending (特許出願済). See [NOTICE](NOTICE) for attribution requirements.

### Recommendation

Before deploying this software in any production or commercial capacity, consult with a qualified attorney specializing in Japanese fintech regulations.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

Copyright 2026 JPYC Commerce MCP Contributors
