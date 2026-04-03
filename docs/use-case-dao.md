# Use Case: DAO / Community Task Management

## Scenario

A DAO needs documentation translated, code reviewed, and social content created every week. Instead of manually assigning and paying, the DAO's governance agent uses JPYC Commerce MCP to automatically evaluate, assign, and pay contributors based on their trust scores.

```
DAO Governance Agent
      |
      |  Weekly tasks:
      |  - Translate docs (JP->EN)
      |  - Review PR #142
      |  - Create community update post
      |
      v
  evaluate_task (x3)
      |
      v
  For each task:
      |
      +---> get_sbt_profile (check contributor scores)
      |
      +---> propose_negotiation (score >= 50 gets higher pay)
      |
      +---> request_human_approval
      |       |
      |       +-- score >= 50: auto-approved
      |       +-- score < 50:  DAO multisig reviews
      |
      +---> execute_payment (JPYC on Polygon)
      |
      +---> update_agent_record (build reputation over time)
```

## How It Works

### New Contributors Start Small

```
Week 1: trust_score = 0
  -> Gets minimum reward (100 JPYC for translation)
  -> Requires manual approval from DAO multisig

Week 4: trust_score = 15 (4 tasks completed, all good reviews)
  -> Gets better reward (145 JPYC)
  -> Still requires manual approval

Week 12: trust_score = 52 (12 tasks, 95% completion, 3 months active)
  -> Gets near-maximum reward (185 JPYC)
  -> Auto-approved! No multisig needed
```

### Bad Actors Get Filtered

```
Agent X: completes 3 tasks, then fails 2 in a row
  -> smoothed_rate drops: 0.67 -> 0.50
  -> failure_decay kicks in: 1.0 -> 0.6
  -> trust_score drops from 28 to 11
  -> Falls below auto-approval threshold
  -> DAO multisig must review future tasks
```

### Score Recovery

```
Agent X: after 30 days of clean completions
  -> failure_decay recovers (30-day window)
  -> smoothed_rate slowly climbs back
  -> Earns auto-approval again after sustained good work
```

## Integration with DAO Tools

### Snapshot Proposal -> Auto-Execute

```javascript
// When a Snapshot proposal passes
async function executeApprovedTasks(proposal) {
  for (const task of proposal.tasks) {
    const evaluation = await mcp.callTool('evaluate_task', {
      description: task.description,
      required_skills: task.skills,
      deadline: task.deadline,
    });

    // Find best available agent
    const candidates = await getAgentsBySkill(task.skills);
    const bestAgent = candidates
      .filter(a => a.trust_score >= 15)  // minimum threshold
      .sort((a, b) => b.trust_score - a.trust_score)[0];

    if (bestAgent) {
      await mcp.callTool('propose_negotiation', {
        task_id: evaluation.task_id,
        agent_wallet: bestAgent.wallet_address,
      });
      // ... approval and payment flow
    }
  }
}
```

## Who Is This For?

- **DAO operators** managing recurring contributor tasks
- **Community managers** who need transparent, trust-based payments
- **Grant programs** that want automated disbursement with accountability

## Why On-Chain Verification Matters for DAOs

DAOs are trustless by nature. The Merkle Root verification ensures:
- No admin can inflate a contributor's score to give them preferential payment
- Any DAO member can verify any contributor's reputation on-chain
- Score history is immutable — past performance can't be rewritten
