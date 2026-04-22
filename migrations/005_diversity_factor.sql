-- Migration 005: Trust Score V4 — Diversity Factor サポート
-- シビル攻撃耐性（CVE-T1 対策）のための unique counterparty 集計関数を追加
-- 実行: P0-07 (Neon 移行) 完了後に Neon DB で実行
-- 根拠: docs/diversity-factor-v4-sql-spec.md、docs/trust-score-sybil-review.md
--
-- NOTE: unique_counterparty_count カラムは 001_init.sql で追加済みのため本ファイルに追加不要
-- NOTE: count_active_months 関数も 001_init.sql で SEC-2 対応済み（DISTINCT で重複排除）
--       本ファイルはその関数に依存しない独立した集計ロジックを提供する

-- ---------------------------------------------------------------------------
-- get_unique_counterparties: 全ロール（task/seller/buyer）での
-- ユニーク取引相手 wallet アドレス数を返す
-- ---------------------------------------------------------------------------
-- 引数: p_agent_id — mcp_agents.id (UUID)
-- 戻り値: ユニーク取引相手数 (INTEGER)
-- 用途: Trust Score V4 の Diversity Factor 算出
--       diversity = MIN(1.0, result / completion_count * 2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_unique_counterparties(p_agent_id UUID)
RETURNS INTEGER AS $$
  WITH agent AS (
    SELECT wallet_address FROM mcp_agents WHERE id = p_agent_id
  ),
  -- task ロール: negotiations 経由で対になった相手エージェント
  task_counterparties AS (
    SELECT DISTINCT n.agent_wallet AS counterparty
    FROM mcp_task_results tr
    JOIN mcp_negotiations n ON n.task_id = tr.task_id
    CROSS JOIN agent a
    WHERE tr.agent_id    = p_agent_id
      AND tr.result      = 'completed'
      AND n.agent_wallet != a.wallet_address
  ),
  -- seller ロール: orders の buyer_wallet
  seller_counterparties AS (
    SELECT DISTINCT o.buyer_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.seller_wallet = a.wallet_address
      AND o.status        = 'delivered'
  ),
  -- buyer ロール: orders の seller_wallet
  buyer_counterparties AS (
    SELECT DISTINCT o.seller_wallet AS counterparty
    FROM mcp_orders o
    CROSS JOIN agent a
    WHERE o.buyer_wallet  = a.wallet_address
      AND o.status        = 'delivered'
  ),
  -- 3ロール分を UNION して wallet レベルでユニーク化
  all_counterparties AS (
    SELECT counterparty FROM task_counterparties
    UNION
    SELECT counterparty FROM seller_counterparties
    UNION
    SELECT counterparty FROM buyer_counterparties
  )
  SELECT COUNT(*)::INTEGER FROM all_counterparties;
$$ LANGUAGE SQL STABLE;

-- ---------------------------------------------------------------------------
-- trg_update_unique_counterparty: 取引完了時に unique_counterparty_count を更新
-- ---------------------------------------------------------------------------
-- mcp_task_results に completed が挿入された時、および
-- mcp_orders が delivered に更新された時に自動実行される
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_update_unique_counterparty()
RETURNS TRIGGER AS $$
BEGIN
  -- task_results 挿入時: agent_id 側のカウントを更新
  IF TG_TABLE_NAME = 'mcp_task_results' AND NEW.result = 'completed' THEN
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(NEW.agent_id),
        updated_at                = NOW()
    WHERE id = NEW.agent_id;
  END IF;

  -- orders 更新時: seller/buyer 両方のカウントを更新
  IF TG_TABLE_NAME = 'mcp_orders' AND NEW.status = 'delivered' THEN
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(id),
        updated_at                = NOW()
    WHERE wallet_address = NEW.seller_wallet;

    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(id),
        updated_at                = NOW()
    WHERE wallet_address = NEW.buyer_wallet;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- mcp_task_results 完了時トリガー
CREATE TRIGGER trg_task_results_counterparty
  AFTER INSERT OR UPDATE ON mcp_task_results
  FOR EACH ROW EXECUTE FUNCTION trg_update_unique_counterparty();

-- mcp_orders 納品完了時トリガー
CREATE TRIGGER trg_orders_counterparty
  AFTER UPDATE OF status ON mcp_orders
  FOR EACH ROW
  WHEN (NEW.status = 'delivered')
  EXECUTE FUNCTION trg_update_unique_counterparty();

-- ---------------------------------------------------------------------------
-- インデックス: get_unique_counterparties の集計クエリを高速化
-- ---------------------------------------------------------------------------

-- task_counterparties の JOIN 高速化
CREATE INDEX IF NOT EXISTS idx_task_results_agent_completed
  ON mcp_task_results (agent_id, result)
  WHERE result = 'completed';

-- seller_counterparties の絞り込み高速化
CREATE INDEX IF NOT EXISTS idx_orders_seller_delivered
  ON mcp_orders (seller_wallet, status)
  WHERE status = 'delivered';

-- buyer_counterparties の絞り込み高速化
CREATE INDEX IF NOT EXISTS idx_orders_buyer_delivered
  ON mcp_orders (buyer_wallet, status)
  WHERE status = 'delivered';

-- ---------------------------------------------------------------------------
-- COMMENT
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION get_unique_counterparties(UUID) IS
  'Trust Score V4 Diversity Factor 用: エージェントのユニーク取引相手数を全ロール（task/seller/buyer）で集計して返す';

COMMENT ON FUNCTION trg_update_unique_counterparty() IS
  'mcp_task_results または mcp_orders に完了レコードが入った際に mcp_agents.unique_counterparty_count を自動更新するトリガー関数';
