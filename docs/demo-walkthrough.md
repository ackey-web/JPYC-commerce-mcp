# Demo Walkthrough

## Prerequisites

1. Supabase project with MCP tables migrated
2. `npm install` completed
3. `.env` or `.env.local` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

## Run the Full Demo

```bash
node demo.js
```

This runs the complete 7-step flow:

```
Step 1: get_sbt_profile     -> New agent created (trust_score: 0)
Step 2: evaluate_task        -> AI analyzes task (difficulty: 0.72, reward: 488-748 JPYC)
Step 3: propose_negotiation  -> Proposes 488 JPYC (new agent = minimum)
Step 4: request_human_approval -> Manual approval (score too low for auto)
Step 5: execute_payment      -> Mock JPYC transfer
Step 6: update_agent_record  -> trust_score: 0 -> 6.17
Step 7: get_sbt_profile      -> Verify score updated
```

## What to Observe

### New Agent Starts at Minimum

The first time an agent is seen, they get `trust_score: 0` and the minimum reward. This is by design — new agents haven't proven themselves yet.

### Score Grows with Completions

After completing the demo task with `sentiment: 0.85`, the score jumps to ~6.17. Run the demo multiple times to watch the score grow:

| Run | trust_score | proposed_amount |
|-----|-------------|-----------------|
| 1 | 0 -> 6.17 | 488 JPYC (minimum) |
| 2 | 6.17 -> 14.2 | 505 JPYC |
| 5 | ~35 | 579 JPYC |
| 10 | ~52 | 623 JPYC |

### Auto-Approval Kicks In

Once `trust_score >= 50` (around 10 successful tasks), `request_human_approval` returns `auto_approved: true` instead of requiring manual review.

### AI Analysis

If `ANTHROPIC_API_KEY` is set, `evaluate_task` returns rich analysis:

```json
{
  "scoring_method": "ai_enhanced",
  "ai_analysis": {
    "complexity": 0.8,
    "estimated_hours": 120,
    "risk_factors": ["AI/ML integration complexity", "Smart contract security"],
    "rationale": "High-complexity task combining AI and blockchain"
  }
}
```

Without the key, it falls back to formula-only scoring (still accurate, just less detailed).

## Try It in Claude Desktop

1. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Restart Claude Desktop
3. Ask:

> "Check the trust profile for wallet 0xABCD1234..."

> "I need someone to build a React dashboard with PostgreSQL backend, deadline in 2 weeks. Evaluate this task."

> "The task is done and the quality was 0.9 out of 1.0. Update the agent's record."
