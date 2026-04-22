# AI店員・タスクバウンティ経済設計ドラフト（Rezona統合版）

> **スコープ**: Phase 1+ 向けの設計ドラフト。Phase 0+ では実装しない。
> **想定統合先**: Rezona（ブラウザ完結型メタバース、`~/Desktop/rezona/`）
> **作成**: tokenomics-advisor / 2026-04-21（Rezona実装ファイル参照版）
>
> 法務ディスクレイマー → `docs/disclaimer-readme.md` 参照
> アンチシビル設計 → `docs/trust-score-sybil-review.md` の CVE-T1/T2 対策と整合

---

## 0. 前提：既存 Rezona 実装の確認

### 0-1. 既存 JPYC フロー（tip-listener.ts）

```typescript
// ~/Desktop/rezona/server/tip-listener.ts
// GIFTERRA_CONTRACT の TipSent イベントをリッスン
contract.on('TipSent', (from, to, amount) => {
  io.emit('tip:received', { from, to, amount }); // Socket.io ブロードキャスト
});
```

**特徴**:
- `GIFTERRA_CONTRACT_ADDRESS` の独自コントラクトイベントをポーリング
- 送金はユーザーが自分で実行（リレイヤーなし）、結果をイベントで拾う
- 目的: 「感謝の自発送金」→ TipVFX 演出トリガー

### 0-2. 既存リレイヤー（relayer.ts）

```typescript
// ~/Desktop/rezona/server/lib/relayer.ts
// リレイヤー秘密鍵を保有、MATIC ガス代のみ負担
export async function relayJpycTransfer(to, amount): Promise<string> { ... }
export async function relayTransferWithAuthorization(...): Promise<string> { ... }
```

**特徴**:
- **カストディアル**: サーバーが `RELAYER_PRIVATE_KEY` を保有
- EIP-3009 `transferWithAuthorization` でユーザー署名を中継（ガスレス体験）
- 目的: ユーザーが MATIC を持たなくても JPYC を送れる

### 0-3. 既存店員実装（staff-seed.ts）

```typescript
// ~/Desktop/rezona/server/lib/staff-seed.ts
export const STAFF_WALLETS = ['0x66f1...', '0x1c40...']; // 人間スタッフの実アドレス
```

**特徴**:
- 現在は人間スタッフの wallet アドレスをハードコード
- `is_staff=true` フラグで DB に登録、ZONE への特別アクセス権を付与

---

## 1. tip vs. executePayment の明確な区別

Rezona の既存フローと MCP 決済を**意図的に別扱い**にする。統一プロトコルにするとどちらの意味も薄れる。

| 属性 | Rezona tip（既存） | MCP executePayment（新規） |
|---|---|---|
| 意図 | 感謝・応援の自発送金 | 合意された契約に基づく決済 |
| コントラクト | GIFTERRA_CONTRACT（TipSent イベント） | JPYC ERC-20 直接転送 |
| 承認フロー | なし（即時） | `proposeNegotiation` → `request_human_approval` → 実行 |
| スコアへの影響 | なし（現状） | `update_agent_record` で trust_score 更新 |
| リレイヤー | なし（ユーザー自身が実行） | なし（MCP も非カストディアル、calldata 返却のみ） |
| Socket.io イベント | `tip:received`（既存） | `mcp:payment-calldata`（新規追加） |
| UI 表現 | 即座にパーティクル VFX | 承認モーダル → 署名 → 確認アニメーション |

**設計判断**: tip は感謝経済、MCP payment は契約経済。両者を同じ UI で扱わない。

---

## 2. AI店員エージェントの経済挙動

### 2-1. 人間スタッフ vs. AI エージェント店員の共存設計

```
現在（Phase 0+）                    Phase 1+（AI エージェント追加後）
────────────────────               ────────────────────────────────
STAFF_WALLETS: [                   STAFF_WALLETS: [
  '0x66f1...',  // 人間スタッフ       '0x66f1...',  // 人間スタッフ（継続）
  '0x1c40...',  // 人間スタッフ       '0x1c40...',  // 人間スタッフ（継続）
]                                  ]
                                   // AI エージェントは別テーブルで管理
                                   // mcp_agents テーブル（MCP Neon DB）
                                   // staff フラグなし、別権限モデル
```

**AI エージェント店員の DB 設計（Phase 1+）**

```sql
-- mcp_agents（JPYC-commerce-mcp Neon DB）に追加
ALTER TABLE mcp_agents ADD COLUMN agent_type TEXT DEFAULT 'external';
-- 'external': 外部AIエージェント
-- 'rezona_shopkeeper': Rezona 配置AI店員
-- 'rezona_bounty_worker': バウンティ受注専用

ALTER TABLE mcp_agents ADD COLUMN zone_id TEXT;       -- 配置 ZONE
ALTER TABLE mcp_agents ADD COLUMN owner_wallet TEXT;  -- ZONE オーナー wallet

-- Rezona Neon DB（別プロジェクト）に追加
ALTER TABLE zone_placements ADD COLUMN mcp_agent_wallet TEXT;
-- GLB オブジェクト配置と AI 店員を紐付け
```

### 2-2. 信頼スコア獲得経路

```
Rezona ZONE に AI 店員を配置
  │
  ├── 来訪者と取引（seller ロール）
  │     seller_completion_count++
  │     unique_counterparty_count++ ← CVE-T1 対策（Diversity Factor）
  │
  ├── 来訪者が評価（30日冷却期間）← CVE-T2 対策
  │     seller_avg_sentiment 更新
  │
  └── active_months 蓄積（月1回以上取引）
        longevity ファクター向上
```

**SBT ランク定義**

| ランク | trust_score 目安 | 自動承認上限 | Rezona UI 表示 |
|---|---|---|---|
| Bronze | 0〜30 | 100 JPYC/回 | 銅バッジ |
| Silver | 30〜60 | 500 JPYC/回 | 銀バッジ |
| Gold | 60〜100 | 2,000 JPYC/回 | 金バッジ + スポットライト演出 |
| Platinum | 100+ | 上限なし（人間承認のみ） | 白金バッジ + 専用入場SE |

### 2-3. 取引フロー（Socket.io イベントマッピング）

**パターンA: 商品・サービス販売**

```
来訪者                  Rezona Backend             JPYC-commerce-mcp
   │                        │                            │
   │ [ZONE内アイテムをクリック] │                            │
   │──zone:item-inquire────>│                            │
   │                        │── evaluate_task() ────────>│
   │                        │<── price: 300 JPYC ────────│
   │<──zone:price-quote─────│                            │
   │ [購入ボタン押下]         │                            │
   │──zone:purchase-intent──>│                           │
   │                        │── propose_negotiation() ──>│
   │                        │── request_human_approval() >│
   │<──ui:approval-modal────│                            │
   │ [承認ボタン押下]         │                            │
   │──ui:approval-confirmed──>│                          │
   │                        │── execute_payment() ──────>│
   │                        │<── calldata ───────────────│
   │<──mcp:payment-calldata─│                            │
   │ [Privy ウォレットで署名] │                            │
   │──────── Polygon 送金 ──────────────────────────>   │
   │──zone:tx-confirmed─────>│                           │
   │                        │── update_agent_record() ──>│
   │<──zone:sbt-rank-updated─│                           │
```

**パターンB: 情報提供（マイクロペイメント）**

- 5〜50 JPYC の少額。Silver 以上なら自動承認（承認モーダルなし）
- `zone:info-purchase` → `mcp:auto-approved` → calldata → 署名

**パターンC: タスク委任（AI 店員がさらに外部に発注）**

- 来訪者から受けたタスクを `bounty_post` でバウンティ市場に公募
- 完了後、来訪者に結果を返し JPYC を受け取る
- 店員の `completion_count` が増えるため trust_score が向上

---

## 3. タスクバウンティ経済

### 3-1. 状態遷移モデル

```
[open] → [assigned] → [in_progress] → [delivered] → [completed]
  │                                         │              │
  │                                   [disputed]    update_agent_record
  │                                         │              │
  └──── 期限切れ ────────────────── [expired]       SBT ランク更新
```

### 3-2. エスクロー設計（非カストディアル維持）

Rezona の `relayer.ts` はカストディアル（秘密鍵保有）だが、バウンティエスクローは非カストディアルで設計する。MCP の非カストディアル原則（`docs/legal-notes.md` 参照）を守るため。

```
バウンティ公募時:
  依頼主 → BountyEscrow コントラクトに JPYC 預託（EIP-3009 で署名）
  MCP は preDeposit calldata を返すのみ

納品確認時:
  MCP は confirmDelivery calldata を返す
  依頼主が署名 → コントラクトが受注者に自動解放

プロトコルフィー（Phase 2+）:
  コントラクトが 0.3% を自動控除（MCP は関与しない）
  → 運営主体の資金移動業該当性リスクを回避（docs/legal-notes.md 対策A）
```

### 3-3. マイルストーン型支払い（Phase 2+）

| マイルストーン | 条件 | 解放割合 |
|---|---|---|
| 着手確認 | 受注者が作業開始報告 | 20% |
| 中間納品 | 依頼主が中間成果を確認 | 50% |
| 最終納品 | `confirmDelivery` 実行 | 残り30% |

- 依頼主が 7 日以内に確認しない場合: タイムロックで自動解放
- Phase 1 では一括払いのみ実装、マイルストーンは Phase 2

### 3-4. 紛争解決

**Phase 1（人間仲裁）**

```
raiseDispute 実行
  → MCP: request_human_approval（仲裁者指定 wallet）
  → 仲裁者が resolve_dispute(workerShare%) を呼ぶ
  → 敗者側の recent_failure_rate 上昇（30日間）
  → 評価は CVE-T2 冷却期間（30日）を適用
```

**Phase 2+（Platinum SBT 保有者DAO）**

- trust_score 100+ の Platinum エージェントがランダム選出
- 正しい判断をした仲裁者にバウンティ額の 1% を報酬
- Rezona イベント: `bounty:arbitration-started` / `bounty:arbitration-resolved`

---

## 4. 代理人決済モデル

### 4-1. 委任パラメータ

```sql
-- mcp_agents テーブルに追加（Phase 1+）
ALTER TABLE mcp_agents ADD COLUMN delegation_config JSONB DEFAULT '{}';

-- 例:
{
  "max_per_tx": 500,
  "max_per_day": 2000,
  "max_total": 10000,
  "allowed_categories": ["content_purchase", "task_delegation", "tip_relay"],
  "expires_at": "2026-05-21",
  "require_approval_above": 1000,
  "delegator_wallet": "0xUSER...",
  "agent_wallet": "0xAGENT..."
}
```

### 4-2. 自動承認判定ロジック

```javascript
function shouldAutoApprove(agent, amount, category, config) {
  return (
    amount <= config.max_per_tx &&
    config.allowed_categories.includes(category) &&
    getDailyTotal(agent.id) + amount <= config.max_per_day &&
    getCumulativeTotal(agent.id) <= config.max_total &&
    agent.trust_score >= AUTO_APPROVE_THRESHOLD &&  // デフォルト50
    amount <= config.require_approval_above &&
    new Date() < new Date(config.expires_at)
  );
}
```

- タイムアウト（30秒）で自動拒否（安全側に倒す）
- Rezona UI: `ui:approval-modal` イベント → 画面右下ポップアップ

---

## 5. Rezona × JPYC-commerce-mcp アーキテクチャ

### 5-1. DB 分離戦略（クロス JOIN 不可）

```
Rezona Neon DB（既存）          JPYC-commerce-mcp Neon DB（別プロジェクト）
────────────────────           ──────────────────────────────────────────
zones                          mcp_agents（trust_score, SBT ランク）
zone_placements                mcp_tasks
users（wallet → privy）        mcp_negotiations
zone_objects                   mcp_payments / mcp_bids
```

**SBT ランク情報の共有方法（クロス JOIN なし）**

Option A（推奨・Phase 1）: Rezona Backend が MCP REST API をポーリング
- ユーザー入室時: `GET /api/trust/{wallet}` → MCP Neon DB から取得
- Rezona Neon にキャッシュ（TTL: 5分）
- `zone:agent-enter` 時にバッジ情報を付与してブロードキャスト

Option B（Phase 2+）: MCP が Rezona Webhook に通知
- `update_agent_record` 実行 → Webhook → Rezona DB の trust_cache 更新
- `zone:sbt-rank-updated` ブロードキャスト

### 5-2. 完全アーキテクチャ図

```
[ブラウザ: Rezona R3F + Privy Wallet]
            │
            │ Socket.io (WSS)
            │
[Render: Rezona Backend (Express + Socket.io)]
            │                      │
            │ HTTP / stdio          │ Socket.io
            │                      │
   [JPYC-commerce-mcp]       [全クライアント]
            │
            ├── JPYC-commerce-mcp Neon DB（trust registry）
            └── Polygon RPC（calldata 生成のみ、送金は不実行）

[Polygon Mainnet]
   ← ユーザーが Privy で署名した tx（MCP payment）
   ← Rezona リレイヤー経由の tx（tip / EIP-3009）
   ※ MCP サーバーは Polygon に tx を送らない
```

### 5-3. tip と MCP payment の Polygon 上の識別

```
tip:         GIFTERRA_CONTRACT.TipSent イベント → tip-listener.ts がキャッチ
MCP payment: JPYC ERC-20 Transfer イベント → report_tx_hash で MCP に報告
```

別コントラクトイベントなので混在しない。

---

## 6. Socket.io イベント仕様（新規追加分）

既存イベントは変更しない。Phase 1 で追加するイベントのみ記載。

| イベント名 | 方向 | ペイロード | 説明 |
|---|---|---|---|
| `zone:item-inquire` | client→server | `{ zoneId, itemId, agentWallet }` | 商品問い合わせ |
| `zone:price-quote` | server→client | `{ itemId, price, currency: 'JPYC' }` | MCP 査定結果 |
| `zone:purchase-intent` | client→server | `{ itemId, agentWallet, buyerWallet }` | 購入意思表示 |
| `mcp:payment-calldata` | server→client | `{ paymentId, calldata }` | 署名用 calldata |
| `zone:tx-confirmed` | client→server | `{ paymentId, txHash }` | 送金完了報告 |
| `zone:sbt-rank-updated` | server→broadcast | `{ wallet, rank, score }` | ランク更新通知 |
| `ui:approval-modal` | server→client(targeted) | `{ negotiationId, amount, agentName }` | 承認ポップアップ |
| `ui:approval-confirmed` | client→server | `{ negotiationId, approved: bool }` | 承認/拒否 |
| `bounty:posted` | server→broadcast | `{ bountyId, reward, deadline }` | バウンティ公募 |
| `bounty:completed` | server→broadcast | `{ bountyId, workerId, amount }` | バウンティ完了 |

---

## 7. 実装ロードマップ（Rezona 統合観点）

| 機能 | Phase | Rezona 側 | MCP 側 | 依存タスク |
|---|---|---|---|---|
| SBT バッジ表示 | Phase 1 | `zone:agent-enter` + trust_cache | GET /api/trust API | P0-09B 完了 |
| 商品販売フロー（基本） | Phase 1 | 新規イベント追加 | P0-15, P0-16 完了 | P0-07 Neon 移行 |
| 代理人委任 UI | Phase 1 | 委任設定パネル | delegation_config カラム | P0-16 |
| バウンティ公募・入札 | Phase 1 | バウンティ掲示板 UI | bounty_post ツール | P0-16 |
| マイルストーン型エスクロー | Phase 2 | UI 拡張 | BountyEscrow コントラクト | SBT + コントラクト |
| DAO 型紛争解決 | Phase 3 | 仲裁パネル | Platinum SBT + ガバナンス | Phase 2 |

---

## 8. アンチゲーミング整合チェックリスト

`docs/trust-score-sybil-review.md` の対策との整合確認：

- [x] **CVE-T1 対策**: バウンティ完了時も `unique_counterparty_count` を更新。同一エージェントへの繰り返し発注はスコア寄与を減衰
- [x] **CVE-T2 対策**: 評価（sentiment 更新）は 30 日冷却期間。Rezona UI で「今月すでに評価済み」を表示
- [x] **最低バウンティ金額**: 10 JPYC 以上（スパム公募防止）
- [x] **自己取引防止**: `from_wallet == to_wallet` を MCP が拒否
- [x] **代理人委任の乱用防止**: `max_per_day / max_total` の累積チェック

---

## 9. community-marketing 訴求軸サマリー

**新しい説明**:
> AIエージェントが「Rezona のメタバース空間で店を開き・信頼を積み・バウンティで仕事を受注し・SBTランクで成長する」経済インフラ。
> 人間が設定した上限内で自律的に経済活動を行う代理人決済モデルを**特許出願済**の設計で実現。

**3つの差別化ポイント（Phase 1 公開時の訴求軸）**:
1. **信頼の可視化**: SBT ランクバッジが「何百回も誠実に取引してきた」を Polygon 上で証明
2. **シビル耐性**: Diversity Factor で不正スコアブーストを数学的に防止（正規ユーザー影響ゼロ）
3. **非カストディアル**: MCP は秘密鍵を一切保有しない。送金は常にユーザー自身が Privy で署名

---

---

## 10. BountyEscrow コントラクト I/F 確定版（Phase 0+ 実装反映版）

> **追記**: 2026-04-22 — team-lead 経由ユーザー（またろ氏）承認により Phase 0+ 組込確定。
> **ステータス**: 確定版。コミット待ち（team-lead 最終承認後）。
> **参照**: `docs/bounty-escrow-review.md`（smart-contract-engineer 作成予定）
>
> **Phase 0+ 確定事項（ユーザー承認済）**:
> - スコープ: Phase 0+ に含める（4関数最小実装、`disputeBounty` は Phase 1 延期）
> - Relayer 戦略: **Pluggable Relayer**（デフォルト Gelato、`RELAYER_URL` env で差替可能）
> - 手数料率: **Phase 0+ は 0%**（`protocolFeeBps = 0` immutable）
> - Phase 1+ 手数料導入: DAO ガバナンスにより**新コントラクトデプロイ**方式で実施

### 10-1. 8関数シグネチャ確定版（2026-04-22 またろ氏承認、commit 412bb65）

> **注**: calldata 生成は MCP 側が `ethers.js interface.encodeFunctionData()` で行い、署名・broadcast はユーザー側が実施（非カストディアル原則）。型は実装（BountyEscrow v2）に準拠。

```solidity
// BountyEscrow.sol — 公開 I/F（Solidity 0.8.x、Phase 0+ 確定版 commit 412bb65）

/**
 * @notice バウンティを公募する（JPYC は ERC-20 approve 済みであること）
 * @param jobKey  バウンティ識別子（bytes32、MCP 側が keccak256 で生成）
 * @param amount  報酬額（JPYC wei、uint128）
 * @return jobId  新規バウンティの uint64 ID
 */
function openBounty(bytes32 jobKey, uint128 amount) external returns (uint64 jobId);

/**
 * @notice EIP-3009 署名付き JPYC 転送でバウンティを公募する（ガスレス入口）
 * @param jobKey      バウンティ識別子
 * @param amount      報酬額（JPYC wei、uint128）
 * @param validAfter  EIP-3009 有効開始 timestamp
 * @param validBefore EIP-3009 有効終了 timestamp
 * @param nonce3009   EIP-3009 nonce（bytes32）
 * @param v, r, s     EIP-712 署名
 * @return jobId      新規バウンティの uint64 ID
 *
 * 用途: ユーザーが MATIC を持たない場合の完全ガスレスフロー（Gelato 経由）
 */
function depositWithAuthorization(
    bytes32 jobKey,
    uint128 amount,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce3009,
    uint8 v,
    bytes32 r,
    bytes32 s
) external returns (uint64 jobId);

/**
 * @notice OPEN 状態のバウンティを依頼主がキャンセルし、報酬を返還する（fee ゼロ）
 * @param jobKey  対象バウンティ ID
 *
 * 制約: poster のみ、OPEN 状態限定（ASSIGNED 後は不可）
 * 効果: amount を poster に全額返還、fee ゼロ、状態を CANCELLED に遷移
 */
function cancelBounty(bytes32 jobKey) external;

/**
 * @notice 受注候補として応募する
 * @param jobKey       対象バウンティ ID
 * @param bidAmount    応募者の提示額（JPYC wei、uint128）
 *                     ※ コントラクトが転送するのは Job.amount 全額。
 *                       bidAmount はオンチェーン記録用で支払い額に影響しない。
 * @param proposalHash 提案書コミットメント（IPFS CID or keccak256）
 * @return bidId       新規入札 uint64 ID
 *
 * 設計根拠（bidAmount 維持）:
 *   1. 応募者のレピュテーション指標: 提示額×ランク×スキルを on-chain シグナルとして記録
 *   2. DAO ガバナンス分析素材: 入札分布分析・適正報酬算出に活用可能
 *   3. 将来の柔軟性: Phase 1+ での設計変更余地を残す
 */
function submitBid(
    bytes32 jobKey,
    uint128 bidAmount,
    bytes32 proposalHash
) external returns (uint64 bidId);

/**
 * @notice 入札を承認し、受注者を確定する（OPEN → ASSIGNED）
 * @param jobKey  対象バウンティ ID
 * @param bidId   承認する入札 uint64 ID
 */
function acceptBid(bytes32 jobKey, uint64 bidId) external;

/**
 * @notice 納品物を提出する（ASSIGNED → SUBMITTED）
 * @param jobKey          対象バウンティ ID
 * @param deliverableHash 実際の納品物（IPFS CID or keccak256）
 */
function submitDeliverable(bytes32 jobKey, bytes32 deliverableHash) external;

/**
 * @notice 納品を確認し、エスクローを受注者に解放する（SUBMITTED → CONFIRMED）
 * @param jobKey  対象バウンティ ID
 *
 * 効果: reward × 99.9% を受注者に転送、reward × 0.1% を FEE_RECIPIENT（DAO Safe）へ
 *       MCP が update_agent_record を呼び出して双方の trust_score を更新
 */
function confirmDelivery(bytes32 jobKey) external;

/**
 * @notice 期限切れまたは自動解放を実行する
 * @param jobKey  対象バウンティ ID
 *
 * ケース1（SUBMITTED 状態が 90 日経過）: reward × 99.9% を受注者に自動解放、0.1% → DAO Safe
 * ケース2（OPEN/ASSIGNED 状態が expiresAt 経過）: reward 全額を依頼主に返還（fee ゼロ）
 *
 * Phase 0+ では dispute 仲裁なし。時限失効のみで紛争を解決する設計。
 */
function claimExpired(bytes32 jobKey) external;
```

**MCP 側の calldata 生成パターン**（lib/bountyClient.js）:
```javascript
import { Interface } from 'ethers';
import BountyEscrowABI from '../abi/BountyEscrow.json' assert { type: 'json' };

const iface = new Interface(BountyEscrowABI);

// openBounty（approve 方式）
export function buildOpenBountyCalldata(jobKey, amount) {
  return iface.encodeFunctionData('openBounty', [jobKey, amount]);
}
// depositWithAuthorization（EIP-3009 ガスレス方式）
export function buildDepositWithAuthCalldata(jobKey, amount, validAfter, validBefore, nonce, v, r, s) {
  return iface.encodeFunctionData('depositWithAuthorization', [jobKey, amount, validAfter, validBefore, nonce, v, r, s]);
}
export function buildConfirmDeliveryCalldata(jobKey) {
  return iface.encodeFunctionData('confirmDelivery', [jobKey]);
}
```

### 10-2. 状態遷移とイベント

```
openBounty()   cancelBounty()  submitBid()   acceptBid()   submitDeliverable()   confirmDelivery()
     │               │               │            │                │                     │
  [OPEN] ──────> [CANCELLED]    [OPEN] ──> [ASSIGNED] ──> [SUBMITTED] ──────────> [CONFIRMED]
     │          (poster のみ)   +bids                          │                        │
     │          reward → poster                                │ claimExpired()         │ reward → worker
     │                                                  (90日後: auto release)    MCP: update_agent_record
     │ claimExpired()
  (expiresAt 後: reward → poster)
```

**状態一覧**:

| 状態 | 説明 | 遷移可能な次状態 |
|---|---|---|
| `OPEN` | 公募中（入札受付中） | `ASSIGNED`、`CANCELLED`、`EXPIRED` |
| `CANCELLED` | 依頼主がキャンセル（reward 返還済み） | 終端 |
| `ASSIGNED` | 受注者確定済み | `SUBMITTED`、`EXPIRED` |
| `SUBMITTED` | 納品物提出済み（確認待ち） | `CONFIRMED`、`RELEASED`（90日後） |
| `CONFIRMED` | 納品確認・支払い完了 | 終端 |
| `EXPIRED` | 期限切れ・自動返還完了 | 終端 |

**Solidity イベント**:
```solidity
event BountyOpened(bytes32 indexed bountyId, address indexed poster, uint256 reward, uint256 expiresAt);
event BountyCancelled(bytes32 indexed bountyId, address indexed poster, uint256 refunded);
event BidSubmitted(bytes32 indexed bountyId, bytes32 indexed bidId, address indexed worker, uint256 bidAmount, bytes32 proposalHash);
event BidAccepted(bytes32 indexed bountyId, bytes32 indexed bidId, address indexed worker);
event DeliverableSubmitted(bytes32 indexed bountyId, bytes32 deliverableHash);
event DeliveryConfirmed(bytes32 indexed bountyId, address indexed worker, uint256 released);
event BountyExpired(bytes32 indexed bountyId, address indexed recipient, uint256 amount);
```

### 10-3. プロトコルフィー: 0%（Phase 0+ 確定）

**確定値: `PROTOCOL_FEE_BPS = 0`**（Phase 0+、BountyEscrow v2.1）

```solidity
// setter 関数なし、FEE_RECIPIENT 変数なし
uint256 public constant PROTOCOL_FEE_BPS = 0; // Phase 0+: 完全無料
```

**Phase 0+ が 0% である理由**:
- **ネットワーク効果優先**: 初期ユーザーがコストゼロで使えることで信頼レジストリにエージェントが集積する。スコアが蓄積されるほどレジストリ価値が上がる構造
- **採用障壁最小化**: 競合（Escrow.com: 3〜4%、Upwork 5〜20%）に対して 0% は圧倒的に有利。エコシステム確立フェーズの戦略
- **法的ポジション最大化**: 運営が「業として収益を得ない」ことで資金移動業・電子決済手段業への該当性を最小化
- `constant` にすることで「手数料を取る意図がない」をオンチェーンで証明（setter なし）

> **Phase 1+ 予定: `PROTOCOL_FEE_BPS = 10 (0.1%)` + `FEE_RECIPIENT = DAO Gnosis Safe 2-of-3`**
>
> Phase 1+ では BountyEscrow v2.2 を新規デプロイし、0.1% のプロトコルフィーを DAO Gnosis Safe（2-of-3 multisig）に自動送金する設計を導入予定。詳細は `docs/phase1-roadmap.md` の P1-08 を参照。

**`constant` 設計のトレードオフ**:

| 観点 | メリット | デメリット |
|---|---|---|
| 法的 | 収益意図なしをオンチェーン証明 | Phase 1 手数料導入には新コントラクト必須 |
| 技術 | フィー計算ロジックなしで監査が単純 | 既存 escrow の移行手順が必要 |
| ユーザー | 将来の手数料変更リスクなし（安心感） | Phase 1 移行時のウォレット再承認が必要 |

**Phase 1 移行シナリオ**（将来参考、詳細は `docs/phase1-roadmap.md` P1-08）:
```
1. BountyEscrowV2.2 を新規デプロイ（PROTOCOL_FEE_BPS = 10、FEE_RECIPIENT = DAO Safe）
2. V2.1 の openBounty を非推奨化（新規 bounty 受付停止）
3. V2.1 の進行中 escrow は V2.1 で完遂（confirmDelivery / claimExpired で決着）
4. ユーザーが JPYC.approve を V2.2 アドレスに付け替え
→ 新規バウンティは V2.2 で、進行中は V2.1 で並走（UX 摩擦最小化）
```

### 10-4. Relayer 戦略: Pluggable Relayer（Gelato デフォルト）確定

**確定**: Pluggable Relayer / A案（またろ氏承認、2026-04-22）

**環境変数**:
```
RELAYER_URL=https://relay.gelato.network   # デフォルト
RELAYER_API_KEY=xxx                         # Gelato API key
RELAYER_PROVIDER=gelato                     # "gelato" | "biconomy" | "custom"
```

**非カストディアル原則との整合**（A案でも維持される）:
- MCP サーバーは Gelato に tx を送信しない。ユーザーが EIP-3009 署名した payload を MCP が組み立てて返すのみ
- Gelato は署名済み payload を受け取り Polygon に broadcast する。「署名者 = ユーザー」であり運営は資金操作に関与しない
- `msg.sender` の保護: Gelato は ERC-2771 準拠で `_msgSender()` にオリジナル署名者のアドレスを渡すため、コントラクト側でオリジナル署名者を正しく認識

**実装タスク**: Task #36（`lib/eip3009.js` + `lib/relayerClient.js`）

**フロー**:
```
1. MCP ツールが EIP-3009 typed data（transferWithAuthorization）を生成して返す
2. ユーザーが自分のウォレットで署名
3. ユーザー（またはフロントエンド）が Gelato relay API に署名済み payload を送信
4. Gelato が Polygon に tx をブロードキャスト
5. BountyEscrow コントラクトが JPYC をエスクローに預託
```

### 10-5. Dispute 仲裁不在の経済的含意（Phase 0+ 設計上の受け入れ）

Phase 0+ では `disputeBounty` を**実装しない**。紛争解決は時限失効のみ。

**ゲーム理論的含意**:

| シナリオ | 依頼主 | 受注者 | 結果 | 評価 |
|---|---|---|---|---|
| 正常完了 | confirmDelivery を呼ぶ | 期限内に submitDeliverable | 双方の trust_score 上昇 | 最良 |
| 依頼主が放置（悪意） | confirmDelivery しない | 90日後に claimExpired | 受注者が reward 回収 | **受注者に有利** |
| 受注者が消える | expiresAt 後に claimExpired | submitDeliverable しない | 依頼主が escrow 回収、受注者 trust_score 悪化 | **依頼主に有利** |
| 受注者が低品質納品 | 承認拒否できない（dispute なし）| claimExpired(90日) を待つ | 受注者が reward 回収 | **Phase 0+ の欠陥** |

**欠陥への対策（Phase 0+ 内での緩和）**:
- 低品質納品をした受注者の `seller_avg_sentiment` を低下させる仕組み（MCP の `update_agent_record` 呼び出し時に依頼主の評価を受付）
- trust_score の `recent_failure_rate` 上昇 → Silver 以下に降格すると自動承認上限が下がりリスクが制限される
- `cancelBounty` の範囲: OPEN 状態のみキャンセル可（smart-contract-engineer V2 指示準拠）

**Phase 1 での根本解決**: `disputeBounty` 実装 + Platinum SBT 保有者による人間仲裁

### 10-6. DAO Treasury モデル

#### Phase 0+（launch）: 2-of-3 Gnosis Safe

```
取引完了（confirmDelivery / claimExpired）
         │
         ├── worker: reward × 99.9%
         └── DAO Gnosis Safe: reward × 0.1%
                    │
                    ├── signer 1: maintainer（またろ氏）
                    ├── signer 2: community rep A
                    └── signer 3: community rep B
                              ↓
                    2/3 署名で支出承認
                    maintainer 単独では引き出し不可
```

**Safe 構成**:
- チェーン: Polygon（JPYC と同一チェーン）
- 閾値: 2-of-3 署名必須
- オンチェーン監査: Polygonscan で全 tx 公開
- Safe アドレスは `contracts/deploy/BountyEscrow.json` に記録、誰でも確認可能

**Phase 0+ の使途方針**（DAO メンバーの 2-of-3 署名で決定）:
- インフラコスト（RPC ノード、テストネット faucet 等）
- セキュリティ監査費用（3rd party audit）
- コントリビューター助成金
- エコシステム開発・グラントマッチング

#### Phase 1+: Governance Token 正式化

```
Phase 0+                   Phase 1+                      Phase 2+
──────────────────         ──────────────────────        ──────────────────────
2-of-3 Gnosis Safe         Governance Token 発行          Timelock Governance
maintainer 1 + 2 reps      Platinum SBT 保有者投票         完全分散（signer 自動更新）
手動 multisig 管理          TimelockController 経由         オンチェーン完結
```

**Phase 1+ ガバナンスフロー**:
```
提案者: Platinum SBT 保有者（trust_score 100+）
  ↓
提案: BountyEscrowV3 デプロイ or Treasury 支出承認
  ↓
投票: 7日間（Platinum 1 SBT = 1票、non-transferable で買収不可）
  ↓
可決条件: 過半数 + 最低 5 名
  ↓
TimelockController 48 時間待機（ユーザーが確認・離脱できる猶予）
  ↓
実行（コントラクト更新 or 支出）
```

**Phase 1+ のガードレール（新コントラクトに埋め込み）**:
```solidity
uint16 public constant MAX_FEE_BPS = 100; // 最大 1%（DAO でも超過不可）
uint256 public constant MIN_PROPOSAL_INTERVAL = 30 days; // 30 日以内の再提案不可
```

### 10-7. 運営の非インフラ性（ピュアソフトウェアプロバイダー + DAO Signer 1 of 3）

**Phase 0+ で運営が一切運用しないインフラ**:

| インフラ | 運用主体 | 法的根拠 |
|---|---|---|
| Relayer | ユーザー自身（Gelato を直接利用 or 自前） | 運営が broadcast = 資金移動業リスク |
| MCP サーバー | ユーザー自身（stdio セルフホスト） | stdio 接続、運営サーバー不要 |
| Neon DB | ユーザー自身（各自の無料枠） | 共有レジストリは Phase 1+ の選択肢 |
| Claude API | ユーザー自身（各自の `ANTHROPIC_API_KEY`） | API key は各自の env |
| Polygon ノード | ユーザー自身 or パブリック RPC | `POLYGON_RPC_URL` は各自が指定 |

**運営が提供するもの（インフラなし）**:
- GitHub リポジトリ（Apache 2.0 オープンソース）
- 公式ドキュメント（README、docs/）

**法的ポジション強化ロジック（0.1% fee + DAO Safe 構成）**:

```
運営（maintainer）は:
  秘密鍵を持たない（ユーザー資産に対して）
  資金を直接受け取らない（fee は DAO Gnosis Safe へ）
  Relayer を運用しない（broadcast しない）
  DAO Safe の signer 1/3 に過ぎない（単独引出不可）
  ユーザーの DB・API key を管理しない

  ↓

「ピュアソフトウェアプロバイダー + DAO Signer 1 of 3」として:
  資金移動業 → 非該当（コントラクトが自動分配、運営の裁量介在なし）
  前払式支払手段 → 非該当
  暗号資産交換業 → 非該当
  電子決済手段取扱業（2023年改正後） → 非該当の主張が堅固
```

**DAO Signer として maintainer が持つ権限と制限**:

| 権限 | 説明 |
|---|---|
| Treasury 支出への署名 | 2-of-3 の 1 票（単独では不可） |
| 新コントラクトデプロイの提案 | 提案のみ、実行には 2 署名 |
| Safe の signer 変更 | 他の 2 名の同意が必要 |
| **単独での資金引出** | **不可（設計上）** |
| **fee 率の変更** | **不可（immutable constant）** |

**Phase 1+ でも同じポジションを維持**:
- 新コントラクトの fee も「DAO トレジャリーコントラクト」に自動送金（運営 EOA には入らない）
- Phase 1+ では TimelockController の実行者役のみ（governance 操作、資金保有なし）
- 運営への直接収益フローは Phase 1+ も発生しない設計

> **弁護士レビュー推奨**: 上記の法的ポジション分析は暫定見解。Phase 1 公開前に資金決済法・暗号資産交換業規制の専門家による正式レビューを推奨。

### 10-8. Phase 0+ の資金源モデル

Phase 0+ は手数料ゼロ・運営インフラゼロのため、プロジェクト継続は以下を想定:

**グラント（優先順）**:

| グラント | 規模感 | 訴求ポイント |
|---|---|---|
| **Polygon Village** | $5,000〜$50,000 | Polygon 上の JPYC 決済、エコシステム貢献 |
| **JPYC** | 非公開 | JPYC の採用拡大・ユースケース創出 |
| **Gitcoin Grants** | $500〜$5,000（QF 次第） | OSS パブリックグッズ、MCP エコシステム |
| **Ethereum Foundation** | $5,000〜$30,000 | ERC-5192 SBT の実用化、非カストディアル設計 |

**コミュニティ支援**:

| 手段 | 内容 | タイミング |
|---|---|---|
| **GitHub Sponsors** | 個人・企業からの自発的支援 | Phase 0 公開直後に設定 |
| **エンタープライズサポート** | 大規模利用者向け有償技術サポート契約 | Phase 1+（利用者が増えた段階） |

**Phase 1+ 以降: DAO Treasury（0.1% protocol fee）が主要資金源に**:
- BountyEscrow v2.2 デプロイ後、取引成立ごとに 0.1% が DAO Gnosis Safe に自動蓄積
- 使途: セキュリティ監査 / インフラコスト / コントリビューター助成金 / エコシステム開発
- 詳細は `docs/phase1-roadmap.md` P1-08 参照

**法務上の整合**:
- グラントは「資金提供」（収益でない）→ 資金移動業に非該当
- GitHub Sponsors は「寄付」（サービス対価でない）→ 同様
- エンタープライズサポートは「技術コンサルティング」→ 決済フローへの関与なし
- Phase 1+ の DAO Treasury fee は「コントラクトが自動徴収、DAO Safe 受取」→ 運営個人の「業としての収益」ではない

### 10-9. Phase 1+ コントラクトアップグレードと DAO 正式化経路

```
Phase 0+                Phase 1+                    Phase 2+                  Phase 3+
────────────────        ──────────────────────      ──────────────────────    ──────────────
BountyEscrowV1          BountyEscrowV2               BountyEscrowV3            完全分散型
FEE = 10 bps (0.1%)    FEE = DAO 投票で設定          FEE = Timelock 制御        Platinum DAO
FEE_RECIPIENT = Safe   FEE_RECIPIENT = Gov Token     MAX_FEE_BPS = 100         自律運営
2-of-3 Safe 管理        Platinum SBT 投票              TimelockController        signer 自動更新
```

**V1 → V2 への移行条件**:
- Platinum SBT 保有者が 5 名以上（DAO 成立要件）
- 正式な法務レビュー完了（Phase 1 前に必須）
- V1 の既存 escrow が全て完了状態（CONFIRMED / EXPIRED / CANCELLED）

**Phase 1+ の DAO ガバナンスフロー（参考）**:
```
提案者: Platinum SBT 保有者（trust_score 100+）
  ↓
提案内容: 新コントラクトデプロイ or Treasury 支出
  ↓
投票: 7日間（Platinum 1 SBT = 1票、non-transferable）
  ↓
可決条件: 過半数 + 最低 5 名
  ↓
TimelockController 48 時間待機
  ↓
実行
```

### 10-10. Phase 0+ 確定設計サマリー

| 項目 | 確定値（またろ氏承認 2026-04-22） | 変更方法 |
|---|---|---|
| 実装関数 | 8関数（openBounty + depositWithAuthorization + cancelBounty、dispute なし） | Phase 1 で disputeBounty 追加 |
| `PROTOCOL_FEE_BPS` | `0`（constant、setter なし、Phase 0+ 完全無料） | Phase 1+ で新コントラクト（v2.2）デプロイ |
| `FEE_RECIPIENT` | **なし**（Phase 0+）→ Phase 1+ で DAO Gnosis Safe 2-of-3 | Phase 1+ で新コントラクトに設定 |
| fee 徴収タイミング | Phase 0+ は fee なし | Phase 1+ は confirmDelivery・claimExpired(worker) |
| cancelBounty の fee | **ゼロ**（全額 poster に返金、Phase 0+/1+ 共通） | — |
| Relayer | Pluggable（ユーザーが Gelato を直接利用） | `RELAYER_PROVIDER` env 差替 |
| 運営インフラ | **ゼロ**（GitHub + docs のみ） | Phase 1+ でも同ポジション維持 |
| 運営の fee 受取 | **なし**（DAO Safe 経由、maintainer は 1/3 signer のみ） | Phase 1+ も同設計 |
| 時限失効 | SUBMITTED 状態 90 日 → worker auto release | Phase 1 で調整可 |
| キャンセル | OPEN 状態のみ依頼主が取消可 | — |
| SBT 更新 | confirmDelivery 後に MCP が update_agent_record 呼出 | — |
| 紛争解決 | 時限失効のみ（仲裁なし） | Phase 1 で disputeBounty 追加 |
| 資金源 | DAO Treasury（primary）+ グラント + GitHub Sponsors + エンタープライズ | — |
| 法的ポジション | ピュアソフトウェアプロバイダー + DAO Signer 1 of 3 | Phase 1 前に弁護士レビュー |

---

*最終更新: 2026-04-22（v4→C案: Phase 0+ = 0%、Phase 1+ = 0.1% DAO Safe 予定に変更・8関数確定）| 作成: tokenomics-advisor*
*本書は Phase 1+ の設計ドラフト（セクション1〜9）+ Phase 0+ 確定設計（セクション10）。*
*法務ディスクレイマー: `docs/disclaimer-readme.md` 参照。*
