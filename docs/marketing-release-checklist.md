# Marketing Release Checklist — JPYC Commerce MCP

> **内部ドキュメント**
> 発動指示（project-leader から）を受けてから実行すること。
> 発動条件: **Task #20 (E2E疎通) + Task #31 (公開前セキュリティ監査) 両方完了 + 3日バッファ後**

作成: community-marketing / 2026-04-22
最終更新: 2026-04-22（先行準備情報追記）

---

## 待機中の先行準備（発動前に完了しておくこと）

### SNS アカウント確認（またろ氏への確認事項）

- [ ] **X (Twitter)** — プロジェクト専用アカウントが存在するか確認
  - **確定: @11basslab11**（またろ氏個人アカウント、プロジェクト専用アカウント作成なし）
  - 存在する場合: アカウントURLをここに記録 → `_______________`
- [x] **コミュニティ** — **GitHub Discussions のみ**（Discord 新規サーバー作成なし）
  - URL: https://github.com/ackey-web/JPYC-commerce-mcp/discussions
  - GitHub Discussions のみの場合: リポジトリ設定で Discussions を有効化するだけ

### メディアコンタクト詳細

#### 日本語メディア（★優先度順）

| メディア | コンタクト先 | 備考 |
|---|---|---|
| **CoinPost** ★★★ | 公式サイト問い合わせフォーム / X @coinpost_japan | プレスリリース受付あり |
| **あたらしい経済** ★★★ | 公式サイト問い合わせフォーム / X @neweconomy_media | 寄稿・情報提供受付あり |
| **coindesk JAPAN** ★★☆ | X で担当記者を探してDM、またはjapan@coindesk.com | 直コンが最速 |
| **Cointelegraph Japan** ★★☆ | jp.cointelegraph.com のプレスリリース投稿フォーム | フォーム経由が標準 |
| **Zenn / Qiita** ★☆☆ | 自己投稿 | marketing-drafts.md の文案を流用 |

#### 英語メディア（★優先度順）

| メディア | コンタクト先 | 備考 |
|---|---|---|
| **The Block** ★★★ | tips@theblock.co / X @TheBlock__ DM | ニュースチップス受付あり |
| **Decrypt** ★★★ | tips@decrypt.co | メール受付あり |
| **CoinDesk** ★★☆ | news@coindesk.com | 公式PRポータルもあり |
| **Cointelegraph** ★★☆ | cointelegraph.com/press-releases/submit | プレスリリースフォーム |
| **Hacker News** ★☆☆ | Show HN 自己投稿 | marketing-drafts.md の Show HN テンプレを使用 |

> 注意: 実際の担当記者の X アカウントを見つけて直接コンタクトするほうが反応率が高い。
> 発動前に最新の担当記者名・コンタクト先を再確認すること。

### ピッチメール草案

#### 日本語メディア向け

```
件名: 【プレスリリース】AIエージェント経済インフラ「JPYC Commerce MCP」公開のお知らせ

○○編集部 ご担当者様

はじめてご連絡いたします。JPYC Commerce MCP プロジェクト広報です。

この度、AIエージェント間の経済取引を実現するオープンソースMCPサーバー
「JPYC Commerce MCP」を公開いたしました。

■ 概要
AIエージェントがJPYC（日本円ステーブルコイン）で報酬を受け取り、
Soulbound評判スコア（ERC-5192）を積み上げながら経済活動を行うための
インフラです。秘密鍵を一切保持しないノンカストディアル設計が特徴です。

■ 主な特徴
- MCPツール6本で「査定→交渉→承認→JPYC送金→SBT更新」を完結
- ERC-5192準拠のSoulbound評判スコア（Bronze→Silver→Gold→Platinum）
- Polygon上のJPYC v2を使ったステーブルコイン決済
- 特許出願済のノンカストディアル設計

■ GitHub
https://github.com/ackey-web/JPYC-commerce-mcp（Apache 2.0 ライセンス）

取材・掲載のご検討をいただけますと幸いです。
詳細資料・デモのご案内も可能です。

※本ソフトウェアは実験的なものです。金融・法的アドバイスではありません。
　本番運用前に資金決済法等の適用について法務確認をお願いいたします。
　特許出願済。
```

#### 英語メディア向け

```
Subject: JPYC Commerce MCP — Open-Source Economic Infrastructure for AI Agents (Polygon + Soulbound)

Dear [Editor/Reporter],

We've just released JPYC Commerce MCP, an open-source MCP server that gives
AI agents the economic primitives they've been missing.

Any MCP-compatible agent can now: assess tasks, negotiate JPYC v2 stablecoin
rewards, receive payment via non-custodial calldata, and build a tamper-proof
Soulbound reputation score (ERC-5192) on Polygon.

Key facts:
- 6 MCP tools covering the full assess → negotiate → approve → pay → SBT-update flow
- Non-custodial by design: server returns calldata only, users sign with their own wallet
- Soulbound reputation: Bronze → Silver → Gold → Platinum, Merkle-root anchored on Polygon
- Apache 2.0, Polygon Amoy testnet E2E complete
- Patent pending (特許出願済)

GitHub: https://github.com/ackey-web/JPYC-commerce-mcp

Happy to provide a demo walkthrough or technical deep-dive.

Legal: Not financial or legal advice. Patent pending.
```

---

## Phase 0+: 発動前の Go/No-Go チェックリスト（project-leader が承認前に確認）

### 必須（いずれか未完了なら発動禁止）

- [ ] **Task #20** P0-18 E2E疎通テスト（査定→交渉→承認→JPYC送金→SBT更新）が completed
- [ ] **Task #31** P0-25 公開前セキュリティ監査（10項目チェックリスト）が completed
- [ ] **Task #17** P0-15 JPYC送金ツール実装・Polygon疎通（executePayment.js 本実装）が completed
  → `execute_payment` を「実装済み」として訴求するために必須
- [ ] Diversity Factor V4 が `lib/trustScore.js` に実装済みであることを確認
  → 実装済みなら `marketing-drafts.md` の「導入予定です（近日実装）」を現在形に戻す
  → 未実装のままなら予定表現のままリリース

### 推奨（発動前に対応しておくと良い）

- [ ] コントラクトアドレス（Amoy デプロイ済み）が確定 → 告知文に反映
- [ ] README 刷新後の最新 URL セットを確認
- [ ] NGワードスキャン: `marketing-drafts.md` 全文に「禁止語1」「禁止語2」が含まれていないことを確認
- [ ] SNS アカウント（X）の確認・準備完了
- [x] Discord / GitHub Discussions の方針確定 — **GitHub Discussions のみ** ✅

---

## Phase 1: 発動当日の実行チェックリスト

### 告知文の最終調整

- [ ] Diversity Factor V4 実装状況に応じて表現を確定（現在形 or 予定形）
- [ ] Amoy テストネットのコントラクトアドレスを全告知文に反映
- [ ] `docs/disclaimer-readme.md` の確定版ディスクレイマーが全文に挿入されているか確認
- [ ] 全文「禁止語1」「禁止語2」が含まれていないことを最終確認

### 投稿タイミングと順序

| 順序 | チャンネル | タイミング | 備考 |
|---|---|---|---|
| 1 | **GitHub Discussions** | 任意（先行） | コミュニティ基盤を先に準備（Discord なし） |
| 2 | **X 日本語版** | 平日昼（JST 12:00〜14:00） | CoinPost / あたらしい経済の拡散時間帯 |
| 3 | **Zenn 技術ブログ** | X と同タイミングかその直後 | X でリンク共有 |
| 4 | **X 英語版** | US 朝時間（PST 07:00〜09:00 = JST 24:00〜02:00） | Hacker News がアクティブな時間帯 |
| 5 | **Hacker News Show HN** | US 朝時間（PST 07:00〜09:00） | 英語 X と同タイミング |
| 6 | **Dev.to** | Show HN と同日〜翌日 | HN のトラフィックを Dev.to に引き込む |
| 7 | **メディアピッチ** | 翌営業日以降 | 投稿が出揃ってからピッチ |

### メディアピッチ実行

- [ ] CoinPost へのコンタクト（★★★優先）
- [ ] あたらしい経済へのコンタクト（★★★優先）
- [ ] The Block へのコンタクト（★★★優先）
- [ ] Decrypt へのコンタクト（★★★優先）
- [ ] coindesk JAPAN へのコンタクト（★★☆）
- [ ] Cointelegraph Japan へのコンタクト（★★☆）
- [ ] CoinDesk（英語）へのコンタクト（★★☆）
- [ ] Cointelegraph（英語）へのコンタクト（★★☆）

### コミュニティ立ち上げ

- [ ] GitHub Discussions: Welcome post 投稿（https://github.com/ackey-web/JPYC-commerce-mcp/discussions）
- [ ] Show & Tell 第1弾（demo.js デモ）投稿
- [ ] 日本語チャンネル導入投稿

---

## 注意事項（発動後も変わらない制約）

- **金融・法的アドバイス禁止**: どの告知文にも「これは投資・法的アドバイスではない」趣旨のディスクレイマーを含めること
- **「禁止語1」「禁止語2」絶対禁止**: 「特許出願済」「patent-pending」のみ可
- **未実装機能を「実装済み」と書かない**: Diversity Factor V4 の実装状況を発動前に必ず確認
- **Merkle commit EOA**: 「秘密鍵ゼロ」と書く場合は必ず EOA 例外を注記（「ユーザー資産には一切触れない」を明示）

---

*内部ドキュメント — 公開しない*
*最終更新: 2026-04-22 | 作成: community-marketing*
