-- JPYC Commerce MCP — Neon PostgreSQL 初期スキーマ
-- 既存 GIFTERRA Supabase テーブルとは別物（mcp_ プレフィックスで分離）

-- ---------------------------------------------------------------------------
-- mcp_agents: エージェントの信頼プロファイル
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_agents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address          TEXT UNIQUE NOT NULL,
  trust_score             FLOAT DEFAULT 0.0,
  completion_count        INTEGER DEFAULT 0,
  total_task_count        INTEGER DEFAULT 0,
  smoothed_rate           FLOAT DEFAULT 0.5,
  active_months           INTEGER DEFAULT 0,
  avg_sentiment           FLOAT DEFAULT 0.5,
  sentiment_count         INTEGER DEFAULT 0,
  -- SEC-2: 同月複数タスクを1カウントに抑えるため count_active_months 関数で算出
  -- seller/buyer ロール別スコア
  seller_score            FLOAT DEFAULT 0.0,
  seller_completion_count INTEGER DEFAULT 0,
  seller_total_count      INTEGER DEFAULT 0,
  seller_avg_sentiment    FLOAT DEFAULT 0.5,
  buyer_score             FLOAT DEFAULT 0.0,
  buyer_completion_count  INTEGER DEFAULT 0,
  buyer_total_count       INTEGER DEFAULT 0,
  buyer_avg_sentiment     FLOAT DEFAULT 0.5,
  -- アンチシビル攻撃耐性（CVE-T1: マイクロシビル対策）
  unique_counterparty_count INTEGER DEFAULT 0,
  -- 時刻
  first_task_at           TIMESTAMPTZ,
  last_completed_at       TIMESTAMPTZ,
  last_failed_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_agents_wallet ON mcp_agents(wallet_address);

-- ---------------------------------------------------------------------------
-- mcp_tasks: 査定済みタスク
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tasks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description             TEXT NOT NULL,
  required_skills         TEXT[] DEFAULT '{}',
  deadline                TIMESTAMPTZ,
  difficulty_score        FLOAT,
  recommended_reward_min  INTEGER,
  recommended_reward_max  INTEGER,
  status                  TEXT DEFAULT 'pending',  -- pending / negotiating / approved / completed
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tasks_status ON mcp_tasks(status);

-- ---------------------------------------------------------------------------
-- mcp_negotiations: 交渉レコード
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_negotiations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES mcp_tasks(id),
  agent_wallet    TEXT NOT NULL,
  proposed_amount INTEGER NOT NULL,
  rationale       TEXT,
  status          TEXT DEFAULT 'pending',  -- pending / approved / rejected
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_negotiations_task   ON mcp_negotiations(task_id);
CREATE INDEX IF NOT EXISTS idx_mcp_negotiations_status ON mcp_negotiations(status);

-- ---------------------------------------------------------------------------
-- mcp_payments: 送金記録（ノンカストディアル: calldata 返却のみ）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id  UUID REFERENCES mcp_negotiations(id),
  from_wallet     TEXT NOT NULL,
  to_wallet       TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  tx_hash         TEXT,
  task_result     TEXT,
  status          TEXT DEFAULT 'pending',  -- pending / confirmed / stuck / failed
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_payments_negotiation ON mcp_payments(negotiation_id);
CREATE INDEX IF NOT EXISTS idx_mcp_payments_tx_hash     ON mcp_payments(tx_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_payments_status      ON mcp_payments(status);

-- ---------------------------------------------------------------------------
-- mcp_task_results: タスク完遂履歴（信頼スコア計算の源泉）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_task_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID REFERENCES mcp_agents(id),
  task_id         UUID REFERENCES mcp_tasks(id),
  result          TEXT NOT NULL,  -- completed / failed / timeout / cancelled_by_client / cancelled_by_agent
  sentiment_given FLOAT,
  resolved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_task_results_agent      ON mcp_task_results(agent_id);
CREATE INDEX IF NOT EXISTS idx_mcp_task_results_resolved   ON mcp_task_results(resolved_at);
CREATE INDEX IF NOT EXISTS idx_mcp_task_results_result     ON mcp_task_results(result);

-- ---------------------------------------------------------------------------
-- mcp_orders: 売買注文（purchase / confirmDelivery 用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID,
  buyer_wallet    TEXT NOT NULL,
  seller_wallet   TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  status          TEXT DEFAULT 'pending',  -- pending / escrowed / shipped / delivered / cancelled
  seller_sentiment FLOAT,
  buyer_sentiment  FLOAT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_orders_buyer  ON mcp_orders(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_mcp_orders_seller ON mcp_orders(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_mcp_orders_status ON mcp_orders(status);

-- ---------------------------------------------------------------------------
-- mcp_products: 出品リスト（listProduct / purchase 用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_wallet   TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  price           INTEGER NOT NULL,
  category        TEXT,
  tags            TEXT[] DEFAULT '{}',
  rate_cards      JSONB DEFAULT '{}',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_products_seller ON mcp_products(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_mcp_products_active ON mcp_products(active);

-- ---------------------------------------------------------------------------
-- mcp_bids: 入札（submitBid 用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES mcp_tasks(id),
  agent_wallet    TEXT NOT NULL,
  bid_amount      INTEGER NOT NULL,
  rationale       TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_bids_task ON mcp_bids(task_id);

-- ---------------------------------------------------------------------------
-- mcp_rate_cards: エージェントのスキル別レート（setRateCard / submitBid 用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_rate_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_wallet    TEXT NOT NULL,
  skill           TEXT NOT NULL,
  rate_per_task   INTEGER NOT NULL,
  min_acceptable  INTEGER,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_wallet, skill)
);

CREATE INDEX IF NOT EXISTS idx_mcp_rate_cards_agent ON mcp_rate_cards(agent_wallet);

-- ---------------------------------------------------------------------------
-- mcp_platform_config: プラットフォーム設定（requestHumanApproval 等）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_platform_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO mcp_platform_config (key, value)
VALUES ('human_approval_threshold_jpyc', '1000')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- count_active_months: 同月複数タスクを1カウント（SEC-2修正、DISTINCTで重複排除）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION count_active_months(p_agent_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(DISTINCT TO_CHAR(resolved_at, 'YYYY-MM'))::INTEGER
  FROM mcp_task_results
  WHERE agent_id = p_agent_id
    AND result = 'completed';
$$ LANGUAGE SQL STABLE;
