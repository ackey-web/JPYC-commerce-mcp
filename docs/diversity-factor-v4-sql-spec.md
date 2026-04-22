# Diversity Factor V4 — SQL 関数実装仕様書

> **対象**: `lib/trustScore.js` の Trust Score V4 対応、および Task #9 (Neon マイグレーション) での実装
> **作成**: tokenomics-advisor / 2026-04-21
> **根拠**: `docs/trust-score-sybil-review.md` CVE-T1 対策A

---

## 1. 背景と目的

### 現状の問題（CVE-T1: マイクロ取引量産攻撃）

現行 Trust Score v3 の `volume` ファクターは `completion_count` のみに依存しており、
取引相手の多様性を考慮しない。

```
volume = 10 × log2(1 + completion_count)
```

攻撃者がダミーエージェント 5 体を使って 1,000 回の少額取引を繰り返すと、
正規エージェント（50 取引、相手 40 人）より **+91% のスコア優位**が生じる。

### V4 での修正

`unique_counterparty_count`（ユニーク取引相手数）を用いた Diversity Factor を `volume` に組み込む。

```javascript
// Trust Score V4（lib/trustScore.js に適用）
const diversity = Math.min(1.0, (unique_counterparties / completion_count) * 2);
const volume = 10 * Math.log2(1 + completion_count) * diversity;
```

**効果**:
- 正規エージェント（50 取引、相手 40 人）: diversity = 1.0 → スコア変化なし
- マイクロシビル（1,000 取引、相手 5 体）: diversity = 0.01 → スコア 179 → **1.79** に激減

---

## 2. スキーマ確認

`migrations/001_init.sql` を確認済み。以下のカラムが**すでに追加済み**:

```sql
-- mcp_agents テーブル（001_init.sql より抜粋）
unique_counterparty_count INTEGER DEFAULT 0,
```

**追加マイグレーション不要**。001_init.sql は既に対応済み。

---

## 3. `unique_counterparty_count` の更新ロジック

### 3-1. 更新タイミング

`mcp_task_results` に `result = 'completed'` のレコードが挿入された時点で更新する。
`updateSbtRecord.js`（Task #12 完了済み）の呼び出し後に実行する想定。

### 3-2. SQL 関数（新規追加）

```sql
-- Task #9 マイグレーションファイル（例: 005_diversity_factor.sql）に追加

-- ---------------------------------------------------------------------------
-- refresh_unique_counterparty_count: ユニーク取引相手数を再集計して更新
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_unique_counterparty_count(p_agent_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT
    CASE
      -- task ロール: mcp_negotiations の agent_wallet と対になる task の poster を取得
      -- ※ mcp_task_results → mcp_tasks → 依頼主 wallet の経路
      WHEN tr.result = 'completed' THEN
        (SELECT n.agent_wallet
         FROM mcp_negotiations n
         WHERE n.task_id = tr.task_id
           AND n.agent_wallet != (SELECT wallet_address FROM mcp_agents WHERE id = p_agent_id)
         LIMIT 1)
      ELSE NULL
    END
  )::INTEGER
  INTO v_count
  FROM mcp_task_results tr
  WHERE tr.agent_id = p_agent_id
    AND tr.result = 'completed';

  -- シンプル版（seller/buyer ロール含む全取引を対象にする場合）
  -- orders テーブルと task_results を UNION して相手 wallet を取得
  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql STABLE;
```

**注意**: 上記は概念版。実際の実装は `mcp_orders` テーブル（seller/buyer ロール）と
`mcp_task_results` の両方を対象にする以下の統合版を推奨。

### 3-3. 推奨実装（統合版）

```sql
-- ---------------------------------------------------------------------------
-- get_unique_counterparties: agent_id の全ロール（task/seller/buyer）での
-- ユニーク取引相手 wallet 数を返す
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_unique_counterparties(p_agent_id UUID)
RETURNS INTEGER AS $$
  WITH agent AS (
    SELECT wallet_address FROM mcp_agents WHERE id = p_agent_id
  ),
  task_counterparties AS (
    -- task ロール: negotiations の相手エージェント wallet
    SELECT DISTINCT n.agent_wallet AS counterparty
    FROM mcp_task_results tr
    JOIN mcp_negotiations n ON n.task_id = tr.task_id
    CROSS JOIN agent a
    WHERE tr.agent_id = p_agent_id
      AND tr.result = 'completed'
      AND n.agent_wallet != a.wallet_address
  ),
  seller_counterparties AS (
    -- seller ロール: orders の buyer_wallet
    SELECT DISTINCT o.buyer_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.seller_wallet = a.wallet_address
      AND o.status = 'delivered'
  ),
  buyer_counterparties AS (
    -- buyer ロール: orders の seller_wallet
    SELECT DISTINCT o.seller_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.buyer_wallet = a.wallet_address
      AND o.status = 'delivered'
  ),
  all_counterparties AS (
    SELECT counterparty FROM task_counterparties
    UNION
    SELECT counterparty FROM seller_counterparties
    UNION
    SELECT counterparty FROM buyer_counterparties
  )
  SELECT COUNT(*)::INTEGER FROM all_counterparties;
$$ LANGUAGE SQL STABLE;
```

### 3-4. `mcp_agents` の `unique_counterparty_count` を更新するトリガー

```sql
-- ---------------------------------------------------------------------------
-- update_unique_counterparty_count_trigger:
-- mcp_task_results または mcp_orders に completed/delivered が入ったら自動更新
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_update_unique_counterparty()
RETURNS TRIGGER AS $$
BEGIN
  -- task_results 挿入時（agent_id ベース）
  IF TG_TABLE_NAME = 'mcp_task_results' AND NEW.result = 'completed' THEN
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(NEW.agent_id),
        updated_at = NOW()
    WHERE id = NEW.agent_id;
  END IF;

  -- orders 更新時（seller/buyer 両方を更新）
  IF TG_TABLE_NAME = 'mcp_orders' AND NEW.status = 'delivered' THEN
    -- seller 側の更新
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(id),
        updated_at = NOW()
    WHERE wallet_address = NEW.seller_wallet;

    -- buyer 側の更新
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(id),
        updated_at = NOW()
    WHERE wallet_address = NEW.buyer_wallet;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_results_counterparty
  AFTER INSERT OR UPDATE ON mcp_task_results
  FOR EACH ROW EXECUTE FUNCTION trg_update_unique_counterparty();

CREATE TRIGGER trg_orders_counterparty
  AFTER UPDATE OF status ON mcp_orders
  FOR EACH ROW
  WHEN (NEW.status = 'delivered')
  EXECUTE FUNCTION trg_update_unique_counterparty();
```

**代替案（トリガーを避ける場合）**: `updateSbtRecord.js` の呼び出し後に
`UPDATE mcp_agents SET unique_counterparty_count = get_unique_counterparties($1) WHERE id = $1`
を明示的に実行する。Phase 0+ ではこちらが実装コストが低い。

---

## 4. `lib/trustScore.js` への変更仕様（V4）

### 4-1. `calculateTrustScore` への引数追加

```javascript
// 変更前（V3）
export function calculateTrustScore({
  completion_count, smoothed_rate, active_months,
  avg_sentiment, recent_failure_rate,
}) {
  if (completion_count === 0) return 0;
  const volume = 10 * Math.log2(1 + completion_count);
  // ...
}

// 変更後（V4）
export function calculateTrustScore({
  completion_count, smoothed_rate, active_months,
  avg_sentiment, recent_failure_rate,
  unique_counterparties = null,  // null の場合は V3 互換（diversity = 1.0）
}) {
  if (completion_count === 0) return 0;

  // Diversity Factor（CVE-T1 対策）
  // unique_counterparties が未提供（null）の場合は後方互換として 1.0
  const diversity = unique_counterparties !== null
    ? Math.min(1.0, (unique_counterparties / completion_count) * 2)
    : 1.0;

  const volume = 10 * Math.log2(1 + completion_count) * diversity;
  const reliability = Math.pow(smoothed_rate, 2);
  const longevity = 1 + 0.5 * Math.log2(1 + active_months);
  const reputation = 0.5 + 0.5 * avg_sentiment;
  const failureDecay = Math.max(0.1, 1 - recent_failure_rate);

  return Math.round(volume * reliability * longevity * reputation * failureDecay * 100) / 100;
}
```

### 4-2. `calculateRoleScore` への引数追加

```javascript
// 変更後（V4）— unique_counterparties を mcp_agents から読んで渡す
export function calculateRoleScore(agent, role, recentFailureRate = 0) {
  const unique = agent.unique_counterparty_count ?? null;

  if (role === 'seller') {
    return calculateTrustScore({
      completion_count: agent.seller_completion_count || 0,
      smoothed_rate: ((agent.seller_completion_count || 0) + 1) / ((agent.seller_total_count || 0) + 2),
      active_months: agent.active_months || 0,
      avg_sentiment: agent.seller_avg_sentiment ?? 0.5,
      recent_failure_rate: recentFailureRate,
      unique_counterparties: unique,
    });
  }
  // buyer / task も同様
}
```

---

## 5. 期待値シミュレーション（V4）

| エージェント | 取引数 | 相手数 | diversity | V3スコア | V4スコア | 変化 |
|---|---|---|---|---|---|---|
| 正規（50取引, 相手40人） | 50 | 40 | 1.0 | 93.53 | 93.53 | 変化なし |
| マイクロシビル（1000取引, 相手5体） | 1,000 | 5 | 0.01 | 179.33 | 1.79 | -177.54 |
| リッチシビル（1000取引, 相手100体） | 1,000 | 100 | 0.20 | 179.33 | 35.87 | -143.46 |
| シビル1年（120取引, 相手5体） | 120 | 5 | 0.083 | 145.49 | 12.12 | -133.37 |
| 新規正規（10取引, 相手8人） | 10 | 8 | 1.0 | 38.85 | 38.85 | 変化なし |

---

## 6. Task #9 への組み込み指示（backend-engineer 向け）

### 新規マイグレーションファイルとして追加

```
migrations/005_diversity_factor.sql
```

ファイル内容（最小実装版、トリガーなし）:

```sql
-- Trust Score V4: Diversity Factor サポート
-- unique_counterparty_count は 001_init.sql で追加済みのため追加不要

-- get_unique_counterparties 関数を追加
CREATE OR REPLACE FUNCTION get_unique_counterparties(p_agent_id UUID)
RETURNS INTEGER AS $$
  WITH agent AS (
    SELECT wallet_address FROM mcp_agents WHERE id = p_agent_id
  ),
  seller_counterparties AS (
    SELECT DISTINCT o.buyer_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.seller_wallet = a.wallet_address
      AND o.status = 'delivered'
  ),
  buyer_counterparties AS (
    SELECT DISTINCT o.seller_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.buyer_wallet = a.wallet_address
      AND o.status = 'delivered'
  ),
  all_counterparties AS (
    SELECT counterparty FROM seller_counterparties
    UNION
    SELECT counterparty FROM buyer_counterparties
  )
  SELECT COUNT(*)::INTEGER FROM all_counterparties;
$$ LANGUAGE SQL STABLE;
```

### `lib/db.js` または `updateSbtRecord.js` に追加する更新クエリ

```javascript
// 取引完了時（update_agent_record 相当の処理の末尾）に追加
await db.query(`
  UPDATE mcp_agents
  SET unique_counterparty_count = get_unique_counterparties(id),
      updated_at = NOW()
  WHERE id = $1
`, [agentId]);
```

### `lib/trustScore.js` の変更

セクション 4 の変更を適用（`unique_counterparties` 引数追加、後方互換 `null` デフォルト）。

---

## 7. テストケース（test-trust-score.js への追加分）

```javascript
// CVE-T1 対策：diversity factor のテスト
const microSybil = calculateTrustScore({
  completion_count: 1000, smoothed_rate: 0.99, active_months: 6,
  avg_sentiment: 0.5, recent_failure_rate: 0,
  unique_counterparties: 5,
});
console.assert(microSybil < 5, `マイクロシビルのスコアは5未満であるべき: ${microSybil}`);

const legitimateAgent = calculateTrustScore({
  completion_count: 50, smoothed_rate: 0.9, active_months: 12,
  avg_sentiment: 0.8, recent_failure_rate: 0.05,
  unique_counterparties: 40,
});
console.assert(legitimateAgent > 80, `正規エージェントは80超であるべき: ${legitimateAgent}`);

// 後方互換: unique_counterparties 未指定は V3 と同スコア
const v3compat = calculateTrustScore({
  completion_count: 50, smoothed_rate: 0.9, active_months: 12,
  avg_sentiment: 0.8, recent_failure_rate: 0.05,
  // unique_counterparties: 未指定
});
console.assert(v3compat > 80, `V3互換モードも正常動作するべき: ${v3compat}`);
```

---

*作成: tokenomics-advisor / 2026-04-21*
*参照: `docs/trust-score-sybil-review.md`, `migrations/001_init.sql`, `lib/trustScore.js`*
