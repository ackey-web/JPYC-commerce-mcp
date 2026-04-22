# 信頼スコア アンチシビル攻撃耐性レビュー

> 対象: `lib/trustScore.js` (Trust Score v3)
> 作成: tokenomics-advisor / 2026-04-21

---

## 1. 現行スコア式の概要

```
trust_score = volume × reliability × longevity × reputation × failureDecay

volume        = 10 × log2(1 + completion_count)
reliability   = smoothed_rate²  （Laplace平滑化済み完了率）
longevity     = 1 + 0.5 × log2(1 + active_months)
reputation    = 0.5 + 0.5 × avg_sentiment
failureDecay  = max(0.1, 1 − recent_failure_rate)
```

---

## 2. 発見された脆弱性（重要度順）

### CVE-T1: マイクロ取引量産攻撃 — 重大度: HIGH

**攻撃手法**

攻撃者が少数（5体以上）のダミーエージェントを作成し、0.1〜1 JPYCの少額取引を何千回も繰り返すことで `completion_count` を大量に積み上げる。

**シミュレーション結果（現行v3）**

| エージェント | 取引数 | 相手数 | 月数 | スコア |
|---|---|---|---|---|
| 正規（誠実） | 50 | 40人 | 12 | 93.53 |
| **マイクロシビル** | **1,000** | **5体** | **6** | **179.33** |
| シビル1年（月10回） | 120 | 5体 | 12 | 145.49 |

正規エージェントより **+85.80 ポイント（+91%）** の不正優位が生じる。

**根本原因**

`volume` ファクターが `completion_count` のみに依存しており、取引相手の多様性を考慮しない。少額・同一相手の繰り返し取引も高額・多様な取引と同等に扱われる。

---

### CVE-T2: センチメント相互ブースト攻撃 — 重大度: MEDIUM

**攻撃手法**

攻撃者グループ（2〜5体）が互いに `avg_sentiment = 1.0` の評価を付け合う。

**影響**

`reputation` が最大値（1.0）になり、全スコアが +50% ブーストされる。

```
シビル100取引 + sentiment=0.5 → 73.44
シビル100取引 + sentiment=1.0 → 97.92  (+33%)
```

単独では限定的だが、CVE-T1と組み合わせると効果が複合する。

---

### CVE-T3: active_months 水増し攻撃 — 重大度: LOW

**攻撃手法**

1ヶ月に1回だけ最小取引を行い、`active_months` を増やしながら `longevity` スコアを積み上げる。実質的な活動量は少ない。

**影響**

`longevity` は対数スケールなので影響は限定的だが、CVE-T1・T2と組み合わせると1年で+51.96ポイントの上積みが可能。

---

## 3. 対策案

### 対策A（推奨・即実装可）: unique_counterparty_count によるDiversityファクター

**変更内容**

`mcp_transactions` テーブルから集計した「ユニーク取引相手数（unique_counterparty_count）」を `volume` に組み込む。

```javascript
// Trust Score v4 proposed change
const diversity = Math.min(1.0, (unique_counterparties / completion_count) * 2);
const volume = 10 * Math.log2(1 + completion_count) * diversity;
```

**効果シミュレーション**

| エージェント | v3スコア | v4スコア | 変化 |
|---|---|---|---|
| 正規（50取引, 40人） | 93.53 | 93.53 | 変化なし |
| マイクロシビル（1000取引, 5体） | 179.33 | 1.79 | **-177.54** |
| リッチシビル（1000取引, 100体） | 179.33 | 35.87 | -143.46 |
| シビル1年（120取引, 5体） | 145.49 | 12.12 | -133.37 |

- 正規ユーザーへの影響: **ゼロ**（多様な相手との取引は diversity=1.0 になる）
- マイクロシビルを事実上無効化

**実装要件**

```sql
-- mcp_agents に列追加
ALTER TABLE mcp_agents ADD COLUMN unique_counterparty_count INTEGER DEFAULT 0;

-- 取引完了時に更新
UPDATE mcp_agents
SET unique_counterparty_count = (
  SELECT COUNT(DISTINCT counterparty_agent_id)
  FROM mcp_transactions
  WHERE agent_id = $1 AND status = 'completed'
)
WHERE id = $1;
```

---

### 対策B（推奨・中期）: 金額重み付き取引量

**変更内容**

`completion_count` の代わりに JPYC金額の対数和（weighted_volume）を使う。

```javascript
// weighted_volume = Σ log2(1 + amount_jpyc) per transaction
const volume = Math.log2(1 + weighted_volume);
```

**効果**

0.1 JPYC × 1000回 の攻撃が、100 JPYC × 10回 よりスコアが大幅に低くなる。

**実装コスト**: `mcp_agents.weighted_volume` フィールドの追加と更新ロジックが必要。

---

### 対策C（推奨・中期）: センチメント評価の冷却期間

**変更内容**

同一エージェントペアからの評価は、30日以内の重複を無効化する。

```sql
-- 最後の評価から30日経過していない場合は更新しない
INSERT INTO agent_sentiments (from_agent, to_agent, score, created_at)
SELECT $1, $2, $3, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM agent_sentiments
  WHERE from_agent = $1 AND to_agent = $2
  AND created_at > NOW() - INTERVAL '30 days'
);
```

**効果**: CVE-T2の相互ブースト攻撃を30日ごとに1回に制限。

---

### 対策D（参考・長期）: Merkle Root 経由の取引集計

`scripts/commitMerkleRoot.js`（Task #19）完成後、Merkle Rootに含まれない取引はスコア計算に算入しない設計。これにより、オフチェーン不正記録の挿入を困難にする。

---

## 4. 優先度マトリクス

| 対策 | 攻撃への効果 | 実装コスト | 推奨タイミング |
|---|---|---|---|
| **A: Diversityファクター** | CVE-T1を無効化 | 低（列追加のみ） | **Phase 0+ 即実装** |
| **C: センチメント冷却期間** | CVE-T2を緩和 | 低（SQLのみ） | **Phase 0+ 即実装** |
| B: 金額重み付け | CVE-T1を更に強化 | 中（DB変更） | Phase 1 |
| D: Merkle連携 | 全般的な整合性 | 高（Task #19依存） | Phase 1+ |

---

## 5. smart-contract-engineer への連携事項

- **対策A** の `unique_counterparty_count` は `updateSbtRecord.js` の呼び出し時に引数として渡す設計変更が必要
- SBTのメタデータ（`sbt_rank_multiplier`）に diversity スコアを反映させると、オンチェーンでもシビル耐性を可視化できる
- Merkle Root commit（Task #19）と組み合わせると、`unique_counterparty_count` の改ざんを防止できる

---

*本レビューは Trust Score v3 (`lib/trustScore.js`) を 2026-04-21 時点で分析したものです。*
*スマートコントラクト実装後は再評価を推奨します。*
