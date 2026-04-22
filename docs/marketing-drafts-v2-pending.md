# Marketing Drafts v2 — C案確定反映済みドラフト

> **内部ドキュメント（下書き）**
> 発動指示が来たら `marketing-drafts.md` にマージして最終版を作成すること。
> 公開は team-lead から「発動」明示命令があるまで禁止。
>
> **このファイルの目的**:
> 1. C案確定（Phase 0+ = 完全無料、Phase 1+ = DAO Treasury ロードマップ）を反映した書き直しリスト
> 2. BountyEscrow × SBT × ノンカストディアル角度の新規ドラフト（Zenn / Dev.to / Show HN）
>
> **C案（確定）**:
> - Phase 0+ = PROTOCOL_FEE_BPS = 0（完全無料）
> - Phase 1+ = DAO Gnosis Safe 2-of-3 multisig への 0.1% DAO Treasury をロードマップとして計画中

作成: community-marketing / 2026-04-22（C案確定反映）

---

## A. 方針変更による書き直しリスト

発動前に `marketing-drafts.md` の以下箇所を差し替えること。

### 確定した方針変更事項

| 項目 | 旧 | 新（C案確定） |
|---|---|---|
| プロトコル手数料（Phase 0+） | 記述なし | **0%（完全無料）** |
| プロトコル手数料（Phase 1+ ロードマップ） | — | **0.1% → DAO Gnosis Safe 2-of-3 multisig（計画中）** |
| 運営主体の手数料受取 | — | **なし（Phase 0+ は手数料なし、Phase 1+ は DAO 経由のみ）** |
| Relayer | 記述なし | **Pluggable Relayer（Gelato デフォルト、ユーザーセルフホスト可）** |
| BountyEscrow | 記述なし | **Phase 0+ で実装・Amoy デプロイ済み** |

### 書き直し対象箇所（marketing-drafts.md）

#### 1. README 英語版訴求セクション — 追記

現行の訴求セクションに以下を追加：

```markdown
- **Trustless Escrow** — BountyEscrow contract holds JPYC in escrow until task delivery
  is confirmed. Currently **zero protocol fee** (Phase 0+). Phase 1+ roadmap: 0.1% fee
  to a DAO-controlled Gnosis Safe multisig — deployer cannot withdraw unilaterally.
```

#### 2. README 日本語版訴求セクション — 追記

```markdown
- **トラストレスエスクロー** — BountyEscrowコントラクトがタスク完遂まで JPYC を保管。
  現在は**プロトコル手数料ゼロ**（Phase 0+）。
  Phase 1+ ロードマップ：0.1% を DAO 管理の Gnosis Safe マルチシグへ（運営単独引出不可）。
```

#### 3. X 280字版（日本語）— C案確定版

```
🚀 JPYC Commerce MCP を公開しました。

AIエージェントが「仕事を受け・JPYC で報酬をもらい・SBT で信頼を積む」経済インフラです。

✅ 査定→交渉→エスクロー決済→SBT更新をMCPツールで完結
✅ BountyEscrow：JPYC をコントラクトが保管、完遂確認で解放
✅ Phase 0+ は完全無料でエージェント経済を試せる
✅ 特許出願済

👉 github.com/ackey-web/JPYC-commerce-mcp
💬 github.com/ackey-web/JPYC-commerce-mcp/discussions

— Author: @11basslab11

#MCP #JPYC #Polygon #SBT #BountyEscrow
```

#### 4. X 280字版（英語）— C案確定版

```
🚀 JPYC Commerce MCP — trustless economic infrastructure for AI agents.

AI agents can now post bounties, earn JPYC via BountyEscrow, and build Soulbound
reputation — zero protocol fee to start, DAO Treasury roadmap for Phase 1+.

✅ BountyEscrow: JPYC held in contract until delivery confirmed
✅ Non-custodial calldata, you sign
✅ ERC-5192 Soulbound reputation
✅ Patent pending

👉 github.com/ackey-web/JPYC-commerce-mcp
💬 github.com/ackey-web/JPYC-commerce-mcp/discussions

— Author: @11basslab11

#MCP #JPYC #Polygon #SBT #AgentEconomy
```

#### 5. ピッチメール（marketing-release-checklist.md）— 差し替え対象箇所

日英ピッチメール草案の「主な特徴」欄に以下を追記：

日本語版追記:
```
- BountyEscrow コントラクト：タスク完遂まで JPYC をコントラクトが保管（トラストレス）
- Phase 0+ は完全無料（プロトコル手数料ゼロ）、Phase 1+ で DAO Gnosis Safe 2-of-3 マルチシグへの 0.1% 手数料をロードマップとして計画
- Pluggable Relayer（Gelato デフォルト、ユーザーセルフホスト対応）
```

英語版追記:
```
- BountyEscrow contract: holds JPYC until delivery confirmed (trustless, no counterparty risk)
- Zero protocol fee in Phase 0+; Phase 1+ roadmap: 0.1% to DAO Gnosis Safe 2-of-3 multisig
- Pluggable Relayer: Gelato default, user self-hosting supported
```

---

## B. 追加ドラフト: BountyEscrow × SBT × ノンカストディアル角度

### B-1. Zenn 技術ブログ（日本語、約800字）

```markdown
# AIエージェントがエスクロー決済で仕事を受注する仕組みを作った

「AIエージェントが仕事を受注して、確実に報酬を受け取る」——この当たり前のようで難しい課題を、
BountyEscrow × SBT × ノンカストディアルの3つの設計原則で解決しました。

## 課題: エージェント間の「信頼の欠如」

AIエージェントが別のエージェントに仕事を依頼する場合、2つの問題があります。
①「この相手は本当に信頼できるのか？」
②「報酬を支払ってもらえるか？」

従来はこの両方を解決するインフラがありませんでした。

## 3つの解決策

### 1. SBT（Soulbound Token）による信頼の証明

相手エージェントの実績を ERC-5192 準拠の Soulbound Token として確認できます。
移転不可能なため改ざんが困難で、Bronze → Silver → Gold → Platinum のランクが
過去の取引実績を忠実に反映します。

### 2. BountyEscrow による報酬保証

```solidity
// JPYC を先にコントラクトに預け、タスク完遂後に解放
function openBounty(uint256 amount, address worker) external;
function confirmDelivery(bytes32 bountyId) external; // → JPYC が worker に解放
```

依頼主が JPYC をコントラクトに預けた時点で、受注者は「完遂すれば必ず受け取れる」と確信できます。
**現在（Phase 0+）はプロトコル手数料ゼロ**で、エージェント経済を試せます。
Phase 1+ ロードマップでは 0.1% を DAO 管理の Gnosis Safe マルチシグへ導入予定（運営単独引出不可）。

### 3. ノンカストディアル設計

MCPサーバーは calldata を返すだけで、秘密鍵を一切保持しません。
実際の送金・署名は常にユーザー自身のウォレットで完結します。

## フロー全体像

```
evaluate_task → propose_negotiation → request_human_approval
→ execute_payment（calldata返却、あなたが署名）→ BountyEscrow に預託
→ confirmDelivery → JPYC 解放 → update_sbt_record（SBTランク更新）
```

すべて MCP ツール 6 本で完結。Claude Desktop等のMCP対応クライアントから直接呼び出せます。

**今なら完全無料でエージェント経済を体験できます。**

GitHub: https://github.com/ackey-web/JPYC-commerce-mcp（Apache 2.0）

> ⚠️ 本番運用前に資金決済法等の適用について法務確認を行ってください。
> 本記事は法的助言ではありません。特許出願済。

---
*Author: @11basslab11 | Project: https://github.com/ackey-web/JPYC-commerce-mcp | Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions*
```

---

### B-2. Dev.to 技術ブログ（英語、約500words）

```markdown
# Trustless AI Agent Commerce: BountyEscrow + Soulbound Reputation on Polygon

What does it take for AI agents to hire each other reliably?

Two problems need solving simultaneously:
1. **Trust**: Is this agent actually reliable?
2. **Payment security**: Will I actually get paid?

**JPYC Commerce MCP** solves both through three layered mechanisms.

## The Stack

### Layer 1: Soulbound Reputation (ERC-5192)

Before engaging, agents can verify each other's track record via `get_sbt_profile`.
ERC-5192 SBTs implement `locked() → true permanently`, making transfers revert at
the contract level. The trust score reflects real on-chain history — not transferable,
not gameable through fake-trade accounts (Diversity Factor sybil resistance, coming soon).

### Layer 2: BountyEscrow — Trustless Payment

```solidity
// Poster locks JPYC in escrow upfront
openBounty(amount, workerAddress);

// Worker completes task, poster confirms → JPYC released
confirmDelivery(bountyId);
```

The poster deposits JPYC into the escrow contract before work begins. The worker
knows payment is guaranteed upon delivery — no counterparty risk.

**Phase 0+ ships with zero protocol fee** — free to experiment. Phase 1+ roadmap:
0.1% to a DAO-controlled Gnosis Safe 2-of-3 multisig. The deployer cannot withdraw
it unilaterally.

### Layer 3: Non-Custodial MCP Server

The MCP server never holds keys or broadcasts transactions. It generates calldata
and returns it to the caller. You sign with your own wallet. This applies to all
six tools — including `execute_payment`.

The only exception: an operator EOA for periodic Merkle root commits (completely
isolated from user assets).

## Pluggable Relayer

For gas abstraction, we support a Pluggable Relayer interface:
- Default: Gelato Network
- Self-hosting: drop in any EIP-2771-compatible forwarder
- Users retain full control over their signing keys regardless of which relayer is used

## The Full Flow

```
get_sbt_profile      → verify counterpart trust score
evaluate_task        → assess difficulty, recommend JPYC range
propose_negotiation  → generate offer combining SBT rank + task difficulty
request_human_approval → mandatory human gate (non-skippable)
execute_payment      → return calldata → you sign → JPYC enters BountyEscrow
confirmDelivery      → JPYC released to worker
update_sbt_record    → on-chain SBT rank updated
```

All via MCP tool calls. Drop it into Claude Desktop, any MCP client, or call via stdio.

**Zero fees in Phase 0+. Try it free.**

Apache 2.0. Hardhat local full E2E complete (Amoy/mainnet deploy at user discretion). Patent pending.

> ⚠️ Not financial or legal advice. Operators must conduct independent legal review
> (including Japanese Payment Services Act if applicable) before production deployment.

---
*Author: @11basslab11 | Project: https://github.com/ackey-web/JPYC-commerce-mcp | Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions*
```

---

### B-3. Hacker News Show HN（英語、BountyEscrow強調版）

```
Show HN: JPYC Commerce MCP – trustless agent-to-agent bounty market (BountyEscrow + Soulbound on Polygon)

https://github.com/ackey-web/JPYC-commerce-mcp

We built an MCP server for trustless AI agent commerce: post bounties, verify Soulbound reputation, and settle in JPYC stablecoin — all without the server touching user keys.

What makes it interesting:

1. **BountyEscrow contract** — JPYC is locked in escrow when a bounty is posted; released only when the poster confirms delivery. No counterparty risk for either side. Phase 0+ ships with zero protocol fee. Phase 1+ roadmap: 0.1% to a DAO Gnosis Safe 2-of-3 multisig (planned as immutable — deployer cannot touch it).

2. **ERC-5192 Soulbound reputation** — `locked()` returns true permanently at the contract level. Trust score is calculated from completion count, counterparty diversity, longevity, and sentiment. We've designed a Diversity Factor to make self-dealing account inflation mathematically ~99% ineffective (shipping soon).

3. **Non-custodial throughout** — MCP server returns calldata only. You sign. The only server-side wallet is an operator EOA for periodic Merkle root commits, completely isolated from user assets.

4. **Pluggable Relayer** — Gelato by default, self-hostable. EIP-2771 compatible.

Tech: Node.js MCP SDK, Neon PostgreSQL (trust registry), ethers.js, Hardhat local (full E2E complete; Amoy/mainnet deploy at user discretion). Apache 2.0.

The economic model: open-source core, zero fees to start, DAO-controlled protocol fee roadmap, no VC, no token launch. Feedback on the escrow design, relayer choice, or sybil resistance math welcome.

Not financial or legal advice. Patent pending (特許出願済).

— Author: @11basslab11
  Project: https://github.com/ackey-web/JPYC-commerce-mcp
  Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions
```

---

## C. 発動時の差し替え手順

1. `marketing-drafts.md` を開く
2. セクション A の「書き直し対象箇所」に従って追記・差し替え
3. セクション B のドラフトを `marketing-drafts.md` の各セクションに追加
4. Diversity Factor V4 実装状況を確認して「導入予定」→「実装済み」に切り替えるか判断
5. コントラクトアドレス（Amoy デプロイ済み）を全文に反映
6. またろ氏 X ハンドル確定後、全テンプレの「@11basslab11」を実際のハンドルに一括置換
7. NGワード最終スキャン（「禁止語1」「禁止語2」ゼロ確認）
8. project-leader に最終版を提出してレビュー → 発動

---

*内部ドキュメント — 公開しない*
*最終更新: 2026-04-22（C案確定・0%ベース全面書き直し） | 作成: community-marketing*
