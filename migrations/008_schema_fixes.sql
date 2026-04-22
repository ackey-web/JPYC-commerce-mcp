-- Migration 008: スキーマ修正（E2E テスト疎通のため）
-- 1. mcp_orders に negotiation_id カラム追加
-- 2. mcp_task_results トリガの status カラム参照エラーを修正
--    （共有関数でテーブルごとのカラムを参照すると PLpgsql コンパイルエラーになるため分離）

-- mcp_orders に negotiation_id 追加（executePayment / confirmDelivery 連携）
ALTER TABLE mcp_orders
  ADD COLUMN IF NOT EXISTS negotiation_id UUID REFERENCES mcp_negotiations(id);

CREATE INDEX IF NOT EXISTS idx_mcp_orders_negotiation ON mcp_orders(negotiation_id);

-- 古いトリガ・関数を完全削除
DROP TRIGGER IF EXISTS trg_task_results_counterparty ON mcp_task_results;
DROP TRIGGER IF EXISTS trg_orders_counterparty ON mcp_orders;
DROP FUNCTION IF EXISTS trg_update_unique_counterparty() CASCADE;
DROP FUNCTION IF EXISTS trg_task_results_update_counterparty() CASCADE;
DROP FUNCTION IF EXISTS trg_orders_update_counterparty() CASCADE;

-- mcp_task_results 専用トリガ関数（result カラムのみ参照）
CREATE OR REPLACE FUNCTION trg_task_results_update_counterparty()
RETURNS TRIGGER AS $body$
BEGIN
  IF NEW.result = 'completed' THEN
    UPDATE mcp_agents
    SET unique_counterparty_count = get_unique_counterparties(NEW.agent_id),
        updated_at = NOW()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;

-- mcp_orders 専用トリガ関数（status カラムのみ参照）
CREATE OR REPLACE FUNCTION trg_orders_update_counterparty()
RETURNS TRIGGER AS $body$
BEGIN
  UPDATE mcp_agents
  SET unique_counterparty_count = get_unique_counterparties(id),
      updated_at = NOW()
  WHERE wallet_address = NEW.seller_wallet;
  UPDATE mcp_agents
  SET unique_counterparty_count = get_unique_counterparties(id),
      updated_at = NOW()
  WHERE wallet_address = NEW.buyer_wallet;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;

-- トリガ再作成（冪等）
CREATE TRIGGER trg_task_results_counterparty
  AFTER INSERT OR UPDATE ON mcp_task_results
  FOR EACH ROW EXECUTE FUNCTION trg_task_results_update_counterparty();

CREATE TRIGGER trg_orders_counterparty
  AFTER UPDATE OF status ON mcp_orders
  FOR EACH ROW
  WHEN (NEW.status = 'delivered')
  EXECUTE FUNCTION trg_orders_update_counterparty();
