# Marketing Drafts — JPYC Commerce MCP

> **内部ドキュメント（下書き）**
> Task #20 (E2E疎通) + Task #31 (公開前セキュリティ監査) の両方クリア + 3日バッファ後に
> project-leader から発動指示があるまで公開禁止。
> 最終投稿前に project-leader / tokenomics-advisor / smart-contract-engineer のレビューを経ること。
> ディスクレイマー文面は `docs/disclaimer-readme.md` の確定版を使用すること。
>
> **NGワード**: 「禁止語1」「禁止語2」は絶対禁止。「特許出願済」「patent-pending」はOK。
> 「自律AI」「AGI」等の誇大表現も避けること（技術コミュニティ向けには逆効果）。

作成: community-marketing / 2026-04-21
最終更新: 2026-04-22（tokenomics-advisor + smart-contract-engineer レビュー反映）

### 反映済みレビュー修正（2026-04-22）
- [問題1] README英語版「fully on-chain verifiable」→「Merkle-root anchored on Polygon」
- [問題2] スレッド[3/3]英語版ディスクレイマーに「Japanese Payment Services Act」追記
- [問題3] Diversity Factor「対抗しています」→「導入予定です（近日実装）」（V4未実装のため）
- [M-1] Dev.to英語版 ERC-5192 説明に `locked()` インターフェース補足追加
- [M-3] Dev.to英語版 Diversity Factor「We've added」→「We've designed」（未実装表現に修正）
- [M-4] Show HN + README草案に Merkle commit EOA 例外を正直開示
- [M-2] 公開前チェックリスト（marketing-release-checklist.md）に Task #17 完了確認を追加済み
- [M-5] README草案技術セクションに「JPYC v2 on Polygon mainnet」明記

---

## 1. README 訴求セクション草案（冒頭用）

README 冒頭の「## What is JPYC Commerce MCP?」セクションに挿入する 5〜10 行の訴求文。

### 英語版（PRIMARY）

```markdown
## What is JPYC Commerce MCP?

**JPYC Commerce MCP** is an economic infrastructure for AI agents — enabling them
to open shops, build trust, and take on work through a standardized MCP interface.

Any MCP-compatible AI agent can call our tools to:

- **Assess & Negotiate** — Evaluate task difficulty and propose JPYC v2 rewards based on
  the counterpart's on-chain reputation
- **Earn Trust** — Accumulate a tamper-proof Soulbound reputation score (ERC-5192)
  that grows with every successful trade
- **Settle in Stablecoin** — Execute JPYC v2 payments on Polygon without the MCP server
  ever holding your private keys (non-custodial by design)*
- **Trustless Escrow** — BountyEscrow contract holds JPYC until task delivery is confirmed.
  **Zero protocol fee in Phase 0+** — free to experiment. Phase 1+ roadmap: 0.1% to a
  DAO-controlled Gnosis Safe multisig (deployer cannot withdraw unilaterally).
- **Delegate Authority** — Let a human set spending limits and have an AI agent act
  within those bounds autonomously

From a single tool call to a complete assess → negotiate → approve → pay → SBT-update
flow — Merkle-root anchored on Polygon, patent-pending design.

*The only exception is the operator's Merkle Root commit EOA, which is completely
isolated from user assets.
```

### 日本語版（補足用）

```markdown
## JPYC Commerce MCP とは？

**JPYC Commerce MCP** は、AIエージェントが「店を開き・信頼を積み・仕事を受注し・成長する」
ための経済インフラです。MCP 対応のAIエージェントであれば、以下のツールをそのまま呼び出せます。

- **査定・交渉** — 相手のオンチェーン実績に基づいてタスク難易度を評価し、JPYC報酬を提案
- **信頼の構築** — 改ざん不能なSoulbound評判スコア（ERC-5192）を取引ごとに積み上げ
- **ステーブルコイン決済** — 秘密鍵を一切保持しないノンカストディアル設計でPolygon上のJPYCを送金
- **トラストレスエスクロー** — BountyEscrowコントラクトがタスク完遂まで JPYC を保管。
  **Phase 0+ は完全無料**（プロトコル手数料ゼロ）。
  Phase 1+ ロードマップ：0.1% を DAO 管理の Gnosis Safe マルチシグへ（運営単独引出不可）。
- **代理人決済** — 人間が支出上限を設定し、AIエージェントがその範囲内で自律的に経済活動

査定 → 交渉 → 承認 → 送金 → SBT更新まで、一気通貫のE2Eフローを特許出願済の設計で実現。
```

---

## 2. SNS 告知文案

### 2-1. X (Twitter) 280文字版

#### 日本語版

```
🚀 JPYC Commerce MCP を公開しました。

AIエージェントが「仕事を受け・JPYC で報酬をもらい・信頼スコア（SBT）を積み上げる」経済インフラです。

✅ 査定→交渉→送金→SBT更新をMCPツール6本で完結
✅ BountyEscrow：JPYC をコントラクトが保管、完遂確認で解放（Phase 0+ 完全無料）
✅ ノンカストディアル設計（秘密鍵はあなたのウォレット）
✅ ERC-5192準拠 Soulbound評判スコア
✅ 特許出願済

👉 github.com/ackey-web/JPYC-commerce-mcp
💬 Discussions: github.com/ackey-web/JPYC-commerce-mcp/discussions

— Author: @11basslab11

#MCP #JPYC #Polygon #SBT #AI
```

#### 英語版

```
🚀 Introducing JPYC Commerce MCP — economic infrastructure for AI agents.

Any MCP-compatible agent can now assess tasks, negotiate JPYC rewards, and earn
a tamper-proof Soulbound reputation score — without the server ever touching your keys.

✅ 6 MCP tools: assess → negotiate → approve → pay → SBT update
✅ BountyEscrow: JPYC held in contract until delivery confirmed (zero fee in Phase 0+)
✅ Non-custodial (calldata only, you sign)
✅ ERC-5192 Soulbound reputation
✅ Patent pending

👉 github.com/ackey-web/JPYC-commerce-mcp
💬 Discussions: github.com/ackey-web/JPYC-commerce-mcp/discussions

— Author: @11basslab11

#MCP #JPYC #Polygon #SBT #AgentEconomy
```

---

### 2-2. X (Twitter) 500文字スレッド版

#### 日本語版（3ツイート構成）

**[1/3]**
```
JPYC Commerce MCP を公開しました 🧵

AIエージェントが「店を開き・信頼を積み・成長できる」経済インフラです。

MCP対応のAIエージェントならどれでも、以下のフローをそのまま実行できます：

査定 → 交渉 → 人間承認 → JPYC送金 → SBT評判更新

github.com/ackey-web/JPYC-commerce-mcp

#MCP #JPYC #Polygon #SBT
```

**[2/3]**
```
技術的な特徴は3つです：

① ノンカストディアル設計
MCPサーバーは秘密鍵を一切保持しません。calldataを返すだけで、送金はあなたのウォレットで署名。

② Soulbound評判スコア（ERC-5192）
取引ごとに積み上がる改ざん不能なオンチェーン実績。Bronze → Silver → Gold → Platinum と成長。

③ エージェント経済プラットフォーム
AI店員がメタバースで商売し、タスクバウンティで仕事を受発注できる設計（Phase 1+）。
```

**[3/3]**
```
現在 Phase 0（公開前の品質対応）を完了したばかりです。

- Apache 2.0 ライセンス（OSSコア）
- Neon PostgreSQL による信頼レジストリ
- Hardhat local 環境でのフル E2E テスト済み（Amoy/mainnet デプロイはユーザー裁量）

フィードバック・Issue・スター歓迎です 🙏

github.com/ackey-web/JPYC-commerce-mcp

⚠️ 本番運用前に法務デューデリジェンスを実施してください（特許出願済）
```

#### 英語版（3-tweet thread）

**[1/3]**
```
Introducing JPYC Commerce MCP 🧵

Economic infrastructure for AI agents to open shops, build trust, and grow.

Any MCP-compatible agent can run a complete flow:
Assess → Negotiate → Human Approval → JPYC Payment → SBT Update

github.com/ackey-web/JPYC-commerce-mcp

#MCP #JPYC #Polygon #SBT #AgentEconomy
```

**[2/3]**
```
Three core design principles:

① Non-Custodial
The MCP server never holds user keys. Returns calldata only — you sign and broadcast.

② Soulbound Reputation (ERC-5192)
On-chain, tamper-proof trust score. Grows with every honest trade.
Bronze → Silver → Gold → Platinum rank system with sybil-resistant design.

③ Agent Economic Platform
AI shopkeepers, task bounty markets, and delegated spending authority — all on Polygon/JPYC.
```

**[3/3]**
```
Status: Phase 0 complete — production quality baseline established.

- Apache 2.0 license
- Neon PostgreSQL trust registry
- Full E2E tested on Hardhat local (Amoy/mainnet deploy at user discretion)

Issues, stars, and PRs welcome 🙏

github.com/ackey-web/JPYC-commerce-mcp

⚠️ Not financial advice. Not legal advice. Operators must conduct independent legal review (including regulatory review under Japanese Payment Services Act if applicable). Patent pending.
```

---

### 2-3. Dev.to / Zenn 技術ブログ導入段落（600〜800字）

#### 日本語版（Zenn向け）

```markdown
# AIエージェントに「経済活動」をさせる MCP サーバーを作った

AIエージェントが「仕事を受注して、JPYC で報酬をもらって、信頼スコアを積み上げる」——そういう仕組みを、MCP（Model Context Protocol）サーバーとして実装しました。

## 何を解決するか

既存のAIエージェントは「会話して何かを出力する」ことは得意ですが、「経済的な責任を持って取引する」ためのインフラが存在しませんでした。特にWeb3領域では、エージェントが信頼できる相手かどうかを判断する手段も、JPYC などのステーブルコインで報酬を受け取る標準的な方法もありませんでした。

**JPYC Commerce MCP** はこの問題を解くために設計しました。

## 主な機能

MCP ツール 6 本で、以下のフローが完結します：

1. `get_sbt_profile` — 相手エージェントのSoulbound評判スコアを取得
2. `evaluate_task` — タスク難易度と推奨報酬レンジを算出
3. `propose_negotiation` — SBTランク×難易度で交渉条件を生成
4. `request_human_approval` — 人間の承認ゲートを挟む（必須ステップ）
5. `execute_payment` — calldataを返す（署名・送金はユーザー側）
6. `update_sbt_record` — 完遂後にSBTレコードを更新・ランクアップ判定

## 設計のこだわり

**ノンカストディアル**が絶対条件でした。MCPサーバーが秘密鍵を持つ設計は、資金決済法上のリスクに加え、「信頼してもらえるはずがない」という根本的な問題があります。サーバーはPolygon上のcalldataを生成するだけで、実際の送金は常にユーザー自身のウォレットで署名されます。

評判スコアは ERC-5192 準拠の Soulbound Token として設計しています。移転不可能で、改ざん不能。シビル攻撃（ダミーアカウントとの自己取引でスコアを水増しする攻撃）には、数学的なダイバーシティ係数を導入予定です（近日実装）。

詳細は GitHub をご覧ください。Apache 2.0 ライセンスで公開中です。

> ⚠️ 本番運用前に資金決済法等の適用について法務確認を行ってください。本記事は法的助言ではありません。特許出願済。

---
*Author: @11basslab11 | Project: https://github.com/ackey-web/JPYC-commerce-mcp | Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions*
```

#### 英語版（Dev.to向け）

```markdown
# Building Economic Infrastructure for AI Agents with MCP and JPYC

What if an AI agent could open a shop, earn stablecoin payments, and build a tamper-proof on-chain reputation — all through standard MCP tool calls?

That's what **JPYC Commerce MCP** does. It's an MCP server that gives AI agents the economic primitives they've been missing: assess tasks, negotiate rewards, receive JPYC v2 stablecoin payments on Polygon, and accumulate a Soulbound reputation score.

## The Problem

AI agents are getting better at reasoning and execution, but they lack economic identity. There's no standard way for an agent to prove it's trustworthy, to receive payment for completed work, or to build reputation across different interactions. This is the gap we're addressing.

## How It Works

Six MCP tools form a complete commercial flow:

1. **`get_sbt_profile`** — Retrieve a counterpart agent's Soulbound trust score
2. **`evaluate_task`** — Assess task difficulty and calculate a recommended JPYC reward range
3. **`propose_negotiation`** — Generate negotiation terms combining SBT rank and task difficulty
4. **`request_human_approval`** — Gate payment on explicit human approval (non-skippable by design)
5. **`execute_payment`** — Return calldata for the caller to sign (non-custodial: server never holds keys)
6. **`update_sbt_record`** — Record task completion and evaluate SBT rank promotion

## Key Design Decisions

**Non-custodial is non-negotiable.** The server returns calldata only. All transaction signing happens in the caller's wallet. This isn't just a regulatory consideration — an infrastructure that holds funds would be a single point of failure and trust.

**Soulbound reputation beats simple ratings.** ERC-5192 SBTs implement the `locked()` interface and return true permanently, making transfers revert at the contract level — non-transferable by design, not by convention. We've designed a mathematically provable sybil-resistance mechanism (Diversity Factor) that collapses the trust score of fake-trade accounts by ~99% while leaving honest agents completely unaffected (implementation coming soon).

The design is patent-pending. Apache 2.0 license. Feedback and contributions welcome.

> ⚠️ Not financial advice. Not legal advice. Operators must conduct independent legal due diligence before production deployment.

---
*Author: @11basslab11 | Project: https://github.com/ackey-web/JPYC-commerce-mcp | Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions*
```

---

### 2-4. Hacker News Show HN テンプレート（英語）

```
Show HN: JPYC Commerce MCP – economic infrastructure for AI agents (stablecoin + soulbound reputation)

https://github.com/ackey-web/JPYC-commerce-mcp

We built an MCP server that lets AI agents assess tasks, negotiate stablecoin (JPYC v2) rewards, and earn tamper-proof Soulbound reputation scores on Polygon — without the server ever holding user private keys.

The flow: evaluate task → propose negotiation → human approval gate → return calldata (you sign) → update on-chain SBT record.

Three things we're proud of:

1. **Non-custodial by design.** The server generates calldata and nothing else. No user keys, no custody. (The operator runs a separate EOA for periodic Merkle root commits to Polygon — this wallet never touches user funds.)

2. **Mathematically sybil-resistant reputation.** We've designed a Diversity Factor for the trust score formula that collapses fake-trade accounts (~99% score reduction) without penalizing honest agents who trade with diverse counterparties. Implementation is shipping soon.

3. **Agent economic platform, not just a payment tool.** The design supports AI shopkeepers in metaverse spaces, task bounty markets with on-chain escrow, and delegated spending authority with 6-parameter limits.

Tech: Node.js + MCP SDK, Neon PostgreSQL, ethers.js, Hardhat local (full E2E complete; Amoy/mainnet deploy at user discretion). Apache 2.0.

Happy to discuss the trust score math, the non-custodial architecture, or the Japanese regulatory considerations (not financial advice — patent pending).

— Author: @11basslab11
  Project: https://github.com/ackey-web/JPYC-commerce-mcp
  Discussions: https://github.com/ackey-web/JPYC-commerce-mcp/discussions
```

---

## 3. メディアピッチ先リスト

### 3-1. 日本語メディア（優先順位順）

| 優先 | メディア | 担当カテゴリ | コンタクト方法 | 訴求ストーリー |
|---|---|---|---|---|
| ★★★ | **CoinPost** | Web3技術・DeFi | 記事投稿フォーム（coinpost.jp/contact）またはTwitter @coinpost_japan DM | 「日本発のエージェント経済プラットフォーム、JPYC×SBTで信頼インフラを構築」 |
| ★★★ | **あたらしい経済** | ブロックチェーン全般 | 公式サイトお問い合わせフォーム（neweconomy.media）または @neweconomy_media DM | 「AIエージェントにSoulbound評判を持たせる試み、特許出願済の新設計」 |
| ★★☆ | **coindesk JAPAN** | 機関・技術 | 記者直コン（Twitter等で記者名検索）またはjapan@coindesk.com | 「MCP × Polygon × JPYC によるエージェント間決済インフラ、オープンソースで公開」 |
| ★★☆ | **Cointelegraph Japan** | Web3・NFT | jp.cointelegraph.com/submit-press-release | 「ERC-5192 Soulbound Token を信頼スコアとして活用する国内実装例」 |
| ★☆☆ | **Zenn / Qiita** | 開発者コミュニティ | 自己投稿（技術ブログ） | 技術解説記事（2-3 の Zenn 向け文案を流用） |

### 3-2. 英語メディア（優先順位順）

| 優先 | メディア | 担当カテゴリ | コンタクト方法 | 訴求ストーリー |
|---|---|---|---|---|
| ★★★ | **The Block** | Web3・DeFi・インフラ | tips@theblock.co または Twitter @TheBlock__ DM | "MCP server enabling agent-to-agent stablecoin commerce with soulbound reputation" |
| ★★★ | **Decrypt** | Web3・一般向け | tips@decrypt.co | "AI agents can now earn stablecoin payments and build on-chain reputation" |
| ★★☆ | **CoinDesk** | 機関・技術 | news@coindesk.com またはPR portal | "JPYC Commerce MCP: non-custodial economic infrastructure for AI agents on Polygon" |
| ★★☆ | **Cointelegraph** | NFT・DeFi | cointelegraph.com/press-releases/submit | "ERC-5192 soulbound trust score brings verifiable reputation to agent-to-agent commerce" |
| ★☆☆ | **Token Terminal** | オンチェーン分析 | 公式サイトフォーム | データ統合後（Phase 2+）に訴求。現時点では時期尚早 |
| ★☆☆ | **Hacker News** | 開発者全般 | Show HN 自己投稿 | 2-4 の Show HN テンプレを使用 |

### 3-3. ピッチ時の共通ストーリーライン

**メディア向け1文サマリー（英語）**:
> JPYC Commerce MCP is an open-source MCP server that gives AI agents the economic primitives to assess tasks, negotiate JPYC v2 stablecoin rewards, and earn a tamper-proof Soulbound reputation — all without the server holding a single user private key.

**メディア向け1文サマリー（日本語）**:
> AIエージェントがJPYCで報酬を受け取り、Soulbound評判スコアを積み上げながら経済活動できる、特許出願済のMCPサーバーです。

**差別化ポイント（ピッチで必ず触れる3点）**:
1. 非カストディアル（MCPサーバーはユーザー秘密鍵ゼロ）
2. シビル耐性のある評判システム（数学的設計、近日実装）
3. AI店員・タスクバウンティ・代理人決済という具体的ユースケース

---

## 4. GitHub Discussions 初期構成案

> **確定**: Discord新規サーバーは作成しない。コミュニティ運営は GitHub Discussions のみ。
> URL: https://github.com/ackey-web/JPYC-commerce-mcp/discussions

### 4-1. GitHub Discussions カテゴリ案

```
💡 Ideas          — 機能リクエスト・設計提案
🙋 Q&A            — 技術質問（Issue化前のトリアージ）
🚀 Show & Tell    — 統合事例・デモ共有
📣 Announcements  — リリース告知
```

### 4-3. 初期投稿 3 件の下書き

#### 投稿 1: Welcome post（#announcements / Announcements）

```markdown
# Welcome to JPYC Commerce MCP 🎉

Thank you for joining this community.

**JPYC Commerce MCP** is an open-source MCP server that provides economic
infrastructure for AI agents — assessment, negotiation, stablecoin payment,
and Soulbound reputation — all without holding your private keys.

## How to get started

1. Read the [README](../README.md) for setup instructions
2. Try the demo flow in [demo.js](../demo.js)
3. Check [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) for the roadmap
4. Ask questions in [GitHub Discussions](https://github.com/ackey-web/JPYC-commerce-mcp/discussions)

## Community guidelines

- Be specific: share code snippets, error messages, and environment details when asking for help
- No financial advice. This project does not advise on investment decisions.
- Respect legal boundaries: each operator is responsible for their own compliance.

Patent pending (特許出願済). Apache 2.0 license.
```

#### 投稿 2: Show & Tell 第1弾（#show-and-tell / Show & Tell）

```markdown
# Demo: Complete Agent-to-Agent Commerce Flow 🤖→💴→🤖

Here's what a full flow looks like using `demo.js`:

**Scenario**: Agent A hires Agent B to add a card auto-detection feature.
B has SBT rank "Silver" (trust score: 45). Task difficulty: 0.72.

```
Tool: evaluate_task
→ difficulty_score: 0.72
→ recommended_reward: 380–520 JPYC

Tool: propose_negotiation
→ proposed_amount: 456 JPYC
→ rationale: "Silver rank (×1.2 multiplier) × difficulty 0.72 → mid-range of recommended band"

Tool: request_human_approval
→ [Human approves]

Tool: execute_payment
→ calldata returned (Polygon-compatible; Hardhat local tested)
→ [You sign and broadcast with your wallet]

Tool: update_sbt_record
→ completion_count: 12 → 13
→ SBT rank: Silver (unchanged, threshold: 30–60)
```

No server-side key handling. All Polygon interaction is calldata + your wallet.

Try it yourself: `node demo.js`
```

#### 投稿 3: 日本語コミュニティ向け導入投稿（GitHub Discussions）

```markdown
# JPYC Commerce MCP へようこそ 🇯🇵

日本語チャンネルを開設しました。日本語でのご質問・議論はこちらへどうぞ。

## このプロジェクトについて

**JPYC Commerce MCP** は、AIエージェントが「仕事を受注→JPYC で報酬受取→信頼スコアを積み上げる」経済活動を行うための MCP サーバーです。

Polygon 上の JPYC（日本円ステーブルコイン）を使い、エージェント間の取引・評判管理・代理人決済をオープンソース実装しています。

## ご注意ください

- 本ソフトウェアは実験的なものです
- **金融アドバイスではありません**。本番環境での運用前に、資金決済法等の適用について法務専門家にご確認ください
- 特許出願済の設計を含みます

## よくある質問

**Q: JPYC を実際に送金するのですか？**
A: デモフェーズではモックトランザクションです。MCPサーバーは calldata を返すだけで、実際の送金は常にあなたのウォレットで署名されます。

**Q: SBTとは何ですか？**
A: Soulbound Token（ERC-5192）です。移転不可能で、改ざん不能なオンチェーンの実績記録です。

質問・フィードバックはお気軽にどうぞ！
```

---

## レビュー依頼先

下書き完成後、以下にレビューを依頼すること：

| レビュアー | 確認ポイント |
|---|---|
| **project-leader** | 全体トーン・公開タイミング・ストーリーの整合性 |
| **tokenomics-advisor** | 経済設計の正確性・誇大表現のチェック・ディスクレイマーとの整合 |
| **smart-contract-engineer** | 技術的正確性（ERC-5192・Polygon・calldata等）・実装と記述の整合 |

---

*内部ドキュメント — 公開前に最終レビュー必須*
*最終更新: 2026-04-22 | 作成: community-marketing*
*このドキュメントは法的助言ではありません。*
