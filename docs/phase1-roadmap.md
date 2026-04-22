# Phase 1 ロードマップ — JPYC Commerce MCP

> **作成**: tokenomics-advisor / 2026-04-22
> **前提**: Phase 0+ 完了（SEC-1〜6 修正、E2E 疎通、SBT Amoy デプロイ、法務ディスクレイマー整備）
> **目標**: GitHub 公開後の初期ユーザー獲得 + 公式信頼レジストリの有料運営開始

---

## Phase 1 の目標

1. **公式信頼レジストリの本番稼働**（Neon ホスト、フリーミアム課金）
2. **初期ユーザー 100 エージェント**（登録・SBT 取得・最低1件の取引完了）
3. **収益の初回確認**（月間 ¥10,000 以上の課金ユーザー）
4. **Phase 1 前の法務レビュー**（資金決済法・資金移動業の適用除外確認）

---

## タスク一覧

### P1-01: 公式 Neon レジストリの本番構築

**担当**: backend-engineer
**依存**: P0-07 (Neon 移行) 完了

- 公式レジストリ用 Neon プロジェクトを新規作成（既存 Rezona プロジェクトとは**完全分離**）
- マイグレーション 001〜005 を本番 Neon に実行
- `REGISTRY_URL` を `.env.example` に記載（`https://registry.jpyc-commerce.dev` 想定）
- Neon の無料枠スリープ対策：接続プールサイズを 5 に制限（サーバーレス対応）
- 定期 Merkle Root コミットの GitHub Actions スケジュール設定（P0-24 との連携）

### P1-02: フリーミアム課金プランの設計と実装

**担当**: backend-engineer + tokenomics-advisor（プラン設計）
**依存**: P1-01

**プラン定義（初期案）**:

| プラン | 月額 | 制限 | 対象 |
|---|---|---|---|
| **Free** | 無料 | 月 500 API call / read-only 信頼スコア照会のみ | 個人・試用 |
| **Starter** | ¥2,000 / 月 | 月 5,000 API call / 書き込み可 | 個人開発者・小規模 |
| **Pro** | ¥10,000 / 月 | 無制限 / SLA 99.5% / 優先サポート | 企業・商用 |

**実装タスク**:
- Stripe 決済連携（Checkout → Webhook → Neon のプランフラグ更新）
- API key 発行・レート制限ミドルウェア（`X-JPYC-API-Key` ヘッダー認証）
- `mcp_api_keys` テーブル追加（key hash、plan_tier、monthly_call_count、reset_at）
- 月次カウントリセット Cron（GitHub Actions または Neon の scheduled trigger）

**tokenomics 設計根拠**:
- Free 枠は「read-only 信頼スコア照会のみ」にすることで、信頼レジストリの価値を体験させつつ書き込みは課金を要件にする
- Pro プランの「無制限」はレジストリ品質を守るため実際には `100,000 call/月` の soft limit を設定し、超過時は事前通知してから手動対応

### P1-03: ドキュメンテーションサイト構築

**担当**: frontend-engineer（またはコミュニティ貢献）
**依存**: P0-11 (README 刷新) 完了

- **最小実装**: GitHub Pages + Docusaurus または Nextra（Next.js）
- **必須ページ**:
  - `Getting Started`（5 分で MCP 接続 → 最初の SBT 取得まで）
  - `API Reference`（6 ツールの引数・戻り値・エラーコード）
  - `Trust Score`（V4 計算式・シビル耐性の説明・ランク昇格条件）
  - `Legal`（`docs/disclaimer.md` の内容を HTML 化）
  - `Pricing`（P1-02 のプラン表）
- **ドメイン**: `docs.jpyc-commerce.dev`（取得推奨）または GitHub Pages サブドメイン

### P1-04: 初期ユーザー獲得施策

**担当**: community-marketing（主）+ tokenomics-advisor（経済的インセンティブ設計）
**依存**: P1-03（ドキュメントサイト）+ marketing-drafts.md のレビュー修正完了

**フェーズ分け**:

#### P1-04a: ソフトローンチ（Phase 0 完了 + 3 日バッファ後）
- GitHub 公開アナウンス（X/Twitter・Zenn・HN Show HN）
- `marketing-drafts.md` の確定版を community-marketing が投稿
- 修正必須: 「fully on-chain verifiable」→「Merkle-root anchored on Polygon」（tokenomics-advisor レビュー済み指摘）
- 修正必須: Diversity Factor の「実装済み」表現 → V4 実装完了後に更新

#### P1-04b: コミュニティ形成
- Discord サーバー立ち上げ（`marketing-drafts.md` セクション4の構成案を採用）
- Early Adopter 特典: Phase 1 公開後 30 日以内に Bronze SBT 取得したエージェントに「OG」ロール付与
- 初期 10 エージェントには Pro プラン 3 ヶ月無料（テスト協力のインセンティブ）

#### P1-04c: メディアピッチ
- `marketing-drafts.md` セクション3 のリスト順に実施
- JP 優先: CoinPost ★★★ → あたらしい経済 ★★★
- EN 優先: The Block ★★★ → Decrypt ★★★

### P1-05: 法務レビュー実施

**担当**: project-leader（外部弁護士手配）
**依存**: Phase 1 公開前（D-6 決定事項の実施）
**参照**: `docs/legal-notes.md`

**確認が必要な論点**（優先順）:

1. **非カストディアル原則の法的有効性**
   - MCPサーバーが calldata を返すだけで「資金移動業」に該当しないかの確認
   - `docs/legal-notes.md` セクション1の根拠を弁護士に提示し意見書取得

2. **フリーミアムプランのAPI手数料**
   - 「信頼スコア照会への課金」が資金決済法上の電子決済手段の提供に該当しないかの確認

3. **BountyEscrow.sol のエスクロー手数料**（Phase 1+ で実装の場合）
   - `docs/ai-shopkeeper-bounty-economics.md` セクション8の「手数料をコントラクトに閉じ込める」設計で資金移動業リスクを回避できるかの確認

4. **SBT の有価証券性**
   - `docs/legal-notes.md` セクション4の分析を提示し確認
   - 非移転・無償発行・経済的権利なしの3点が金商法適用除外根拠になるかを確認

**運営主体の確定**（D-5 保留中）:
- Phase 1 の収益発生前に「個人運営」または「法人設立」を決定する必要あり
- `docs/legal-notes.md` セクション6のパターン比較（合同会社 vs. 株式会社 vs. DAO LLC）を参照
- 推奨: まず個人で先行公開 → 月収 ¥10 万超で法人化検討

### P1-06: Diversity Factor V4 の `lib/trustScore.js` 実装

**担当**: backend-engineer（または tokenomics-advisor が直接実装）
**依存**: P1-01（本番 Neon）+ migrations/005_diversity_factor.sql 実行済み
**参照**: `docs/diversity-factor-v4-sql-spec.md` セクション4

- `lib/trustScore.js` に `unique_counterparties` 引数を追加（後方互換 `null` デフォルト）
- `calculateRoleScore` に `agent.unique_counterparty_count` を渡すように修正
- `updateSbtRecord.js` 末尾に `get_unique_counterparties` 更新クエリを追加
- テスト追加（`docs/diversity-factor-v4-sql-spec.md` セクション7のケース）
- **完了後**: `marketing-drafts.md` の Diversity Factor「実装済み」表現を現在形に戻す（community-marketing に通知）

### P1-07: Rezona との MCP 統合パイロット

**担当**: Rezona チーム blockchain-engineer（主）+ tokenomics-advisor（設計レビュー）
**依存**: P1-01 + P1-06 + Rezona side の統合実装
**参照**: `docs/ai-shopkeeper-bounty-economics.md`

- Rezona `zone_placements` テーブルに `mcp_agent_wallet` カラム追加
- `mcp_agents` テーブルへの AI 店員登録 API
- Rezona → MCP レジストリへの信頼スコア照会（REST + 5分 TTL キャッシュ）
- AI 店員の `evaluate_task` → `propose_negotiation` → `request_human_approval` フロー疎通
- **tip（GIFTERRA_CONTRACT）と MCP payment（JPYC ERC-20）は統合しない**（設計原則）
- パイロット空間: Rezona の1 ZONE を AI 店員配置テスト空間として使用

---

## 依存関係グラフ

```
Phase 0+ 完了
    │
    ├── P1-01 (Neon 本番) ──┬── P1-02 (課金実装)
    │                       └── P1-06 (V4 実装)
    │
    ├── P1-03 (ドキュメント) ── P1-04 (ユーザー獲得)
    │
    ├── P1-05 (法務レビュー) ※ P1-04b 開始前に必須
    │
    └── P1-01 + P1-06 ── P1-07 (Rezona 統合パイロット)
```

---

## 収益予測（保守的）

| 月 | MAU エージェント | Free | Starter | Pro | 月収 |
|---|---|---|---|---|---|
| Phase 1 月1 | 20 | 18 | 2 | 0 | ¥4,000 |
| Phase 1 月2 | 50 | 43 | 6 | 1 | ¥22,000 |
| Phase 1 月3 | 100 | 82 | 15 | 3 | ¥60,000 |

Rezona 統合パイロット（P1-07）が成功すれば、Rezona のアクティブユーザー数（想定 200〜500 人）が流入源となり、月3の数字は楽観シナリオで 2〜3 倍になる可能性がある。

---

## Phase 1 完了判定

以下すべてを満たすこと:

- [ ] 公式 Neon レジストリが本番稼働（スリープなし Pro プランまたは相当）
- [ ] フリーミアム課金が Stripe 経由で動作（少なくとも1件の有料課金を確認）
- [ ] ドキュメントサイトが `Getting Started` / `API Reference` / `Legal` を公開
- [ ] 初期ユーザー 50 エージェント以上が SBT Bronze 取得済み
- [ ] 法務意見書取得済み（非カストディアル原則の資金移動業非該当を確認）
- [ ] Diversity Factor V4 が `lib/trustScore.js` に実装済み（`marketing-drafts.md` 表現も更新済み）
- [ ] `docs/legal-notes.md` の運営主体パターンを確定し DEVELOPMENT_PLAN.md に反映

---

## オープン論点（Phase 2 に持ち越し）

- **アンチゲーミング判定のサーバー側ロジック**: DEVELOPMENT_PLAN.md の「秘密ロジック」として OSS 対象外にする部分の具体化
- **CLA の導入タイミング**: コントリビューターが増えた段階で導入（GitHub Apps 経由の CLA-assistant 推奨）
- **BountyEscrow.sol のデプロイ**: Phase 1 では設計のみ、Phase 2 でデプロイ（法務レビュー後）
- **マルチチェーン対応**: Polygon 以外の L2（Base、Arbitrum 等）への拡張は Phase 2+ 以降

---

*作成: tokenomics-advisor / 2026-04-22*
*参照: DEVELOPMENT_PLAN.md, docs/legal-notes.md, docs/ai-shopkeeper-bounty-economics.md, docs/diversity-factor-v4-sql-spec.md, docs/marketing-drafts.md*

---

## P1-08: BountyEscrow v2.2 デプロイ + 0.1% DAO Treasury 導入

**担当**: smart-contract-engineer（コントラクト）+ tokenomics-advisor（経済設計）
**依存**: BountyEscrow v2.1 (Phase 0+) の稼働実績（最低 3 ヶ月）+ Platinum SBT 保有者 5 名以上 + 法務レビュー完了
**参照**: `docs/ai-shopkeeper-bounty-economics.md` セクション10-3・10-9

### 背景と設計原則

Phase 0+ の BountyEscrow v2.1 は `PROTOCOL_FEE_BPS = 0`（constant、fee なし）。Phase 1+ で 0.1% protocol fee と DAO Gnosis Safe を導入するには **BountyEscrow v2.2 を新規デプロイ**する必要がある（immutable のため既存コントラクトは変更不可）。

**重要**: fee は運営に入らない。DAO Gnosis Safe（2-of-3 multisig）に自動送金される。maintainer は Safe signer の 1/3 に過ぎず、単独引出不可。「ピュアソフトウェアプロバイダー + DAO Signer 1 of 3」ポジションを維持する。

### BountyEscrow v2.2 仕様

**constructor（3引数）**:
```solidity
constructor(
    address jpycToken,       // JPYC ERC-20 アドレス
    address feeRecipient,    // DAO Gnosis Safe 2-of-3 アドレス
    address trustedForwarder // ERC-2771 forwarder（Gelato Relay 等）
) {
    FEE_RECIPIENT = feeRecipient;
}

uint256 public constant PROTOCOL_FEE_BPS = 10;  // 0.1%、immutable
address public immutable FEE_RECIPIENT;          // DAO Gnosis Safe 2-of-3
```

**fee 内部分配ヘルパー**:
```solidity
function _distributePayout(bytes32 jobKey, address recipient) internal {
    uint128 reward = jobs[jobKey].amount;
    uint256 fee = (reward * PROTOCOL_FEE_BPS) / 10_000;
    uint256 workerAmount = reward - fee;
    IERC20(jpycToken).transfer(FEE_RECIPIENT, fee);
    IERC20(jpycToken).transfer(recipient, workerAmount);
    emit ProtocolFeeDistributed(jobKey, FEE_RECIPIENT, fee);
}
```

**追加イベント**:
```solidity
event ProtocolFeeDistributed(
    bytes32 indexed jobKey,
    address indexed feeRecipient,
    uint256 fee
);
```

**fee 徴収タイミング**:

| 関数 | fee 徴収 | 説明 |
|---|---|---|
| `confirmDelivery` | あり（reward × 0.1%） | 成功した取引にのみ課金 |
| `claimExpired`（SUBMITTED→worker） | あり | 受注者への自動解放も成功とみなす |
| `claimExpired`（OPEN/ASSIGNED→poster） | **なし** | 未成立案件、全額返金 |
| `cancelBounty` | **なし** | poster への全額返金、DAO も利得なし |

**fee 計算式**:
```solidity
uint256 fee = (reward * PROTOCOL_FEE_BPS) / 10_000;
IERC20(jpycToken).transfer(FEE_RECIPIENT, fee);
IERC20(jpycToken).transfer(worker, reward - fee);
```

**テストスイート（60+ テスト）**:
- v2.1 の既存 46 テストを全継承
- fee 分配: confirmDelivery / claimExpired(worker) で正確に 0.1% が FEE_RECIPIENT に送金されること
- fee ゼロ確認: cancelBounty / claimExpired(poster返還) で全額返金・fee なし
- `ProtocolFeeDistributed` イベントの emit 検証
- constructor の zero address リバート確認（jpycToken, feeRecipient, trustedForwarder 各引数）
- 総計 60+ テストでグリーン

**実装上の注意点**（v2.1 Fee Logic 実装経験より）:
- `_distributePayout(uint64 jobId, uint128 amount, address worker)` の形で jobId を受け取り `ProtocolFeeDistributed(jobId, FEE_RECIPIENT, fee)` を emit する
- `fee == 0`（amount < 10,000 wei の端数切り捨て）の場合は `FEE_RECIPIENT` への transfer をスキップし、`ProtocolFeeDistributed` も emit しない（不要な transfer をガス節約）
- constructor で `FeeRecipientZero` カスタムエラー（revert with custom error）を使う（string revert より gas 安）
- `deployBountyEscrow.js` は 3 引数対応（admin, jpyc, feeRecipient）、`BOUNTY_FEE_RECIPIENT_AMOY` / `BOUNTY_FEE_RECIPIENT_POLYGON` 環境変数を参照

**v2.2 テスト追加目標**: v2.1 の 54 件 → v2.2 で 60 件以上
- fee logic 5 件: `confirmDelivery` fee 分配 / `claimExpired` fee 分配 / `cancelBounty` fee なし / fee+worker 合計検証 / 1 wei 端数切り捨て（fee=0、全額 worker）
- deployment 追加 1 件: `FEE_RECIPIENT` immutable 確認 + FeeRecipientZero revert

### DAO Gnosis Safe 構成（Phase 1+）

```
取引完了（confirmDelivery / claimExpired）
         │
         ├── worker: reward × 99.9%
         └── DAO Gnosis Safe 2-of-3: reward × 0.1%
                    │
                    ├── signer 1: maintainer（またろ氏）
                    ├── signer 2: community rep A
                    └── signer 3: community rep B
                              ↓
                    2/3 署名で支出承認（maintainer 単独不可）
                    全 tx は Polygonscan でパブリックに監査可能
```

### DAO Treasury 使途方針（2-of-3 Safe で承認）

| 使途 | 説明 |
|---|---|
| セキュリティ監査費用 | 3rd party audit（v2.2 および将来コントラクト） |
| インフラコスト | 公式共有レジストリ（Phase 1+ で任意提供）の維持 |
| コントリビューター助成金 | CLA 締結済み OSS コントリビューターへ |
| Platinum 仲裁者報酬 | disputeBounty 仲裁貢献者へ（Phase 1+ 導入後） |
| エコシステム開発 | グラントマッチング、パートナーシップ |
| リザーブ | 緊急対応・法務費用 |

### v2.1 → v2.2 移行フロー（並走方式）

```
Step 1: BountyEscrow v2.2 を Amoy testnet にデプロイ（E2E テスト）
Step 2: Polygon mainnet にデプロイ、FEE_RECIPIENT = DAO Safe アドレス設定
Step 3: v2.1 の openBounty / depositWithAuthorization を非推奨化（新規受付停止）
Step 4: v2.1 の進行中 escrow は v2.1 で完遂（confirmDelivery / claimExpired で決着）
Step 5: ユーザーが JPYC.approve を v2.2 アドレスに付け替え
→ 移行期間: v2.1 の最長 expiresAt（最大 90 日）が終了するまで両バージョン並走
```

### Phase 1+ ガバナンスアップグレードロードマップ

```
Phase 1+: BountyEscrow v2.2 + DAO Gnosis Safe 2-of-3
  │  fee = 0.1% 固定（immutable）、Safe signer = 手動 multisig
  │
Phase 2+: BountyEscrow v3 + Governance Token 正式化
  │  Platinum SBT 保有者投票（non-transferable、1 SBT = 1 票）
  │  fee 変更には 7 日間投票 + 48 時間 TimelockController 待機
  │  MAX_FEE_BPS = 100（最大 1%、DAO でも超過不可）
  │
Phase 3+: 完全分散化
     Safe signer set を Governance Token 結果で動的更新
     オンチェーン完結、maintainer 依存をゼロへ
```

**Phase 2+ ガードレール**（v3 コントラクトに埋め込み）:
```solidity
uint16 public constant MAX_FEE_BPS = 100;               // 最大 1%
uint256 public constant MIN_PROPOSAL_INTERVAL = 30 days; // 再提案間隔
```

### Phase 1 完了判定への追加条件

- [ ] BountyEscrow v2.2 外部監査完了（3rd party）
- [ ] DAO Gnosis Safe 2-of-3 デプロイ済み（signer 3 名の合意）
- [ ] v2.2 を Amoy testnet にデプロイ・E2E テスト完了
- [ ] v2.2 を Polygon mainnet にデプロイ・FEE_RECIPIENT 設定確認
- [ ] v2.1 → v2.2 移行手順ドキュメント整備
- [ ] Platinum SBT 保有者 5 名以上（Phase 2+ ガバナンス成立の最低条件）
- [ ] 法務レビュー完了（資金決済法・資金移動業 DAO Safe 構成の正式見解）

---

*更新: 2026-04-22（P1-08 全面書き換え: C案確定・Phase 1+ = 0.1% DAO Safe・v2.1→v2.2 移行計画・ガバナンスロードマップ）*
