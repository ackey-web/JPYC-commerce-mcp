-- ---------------------------------------------------------------------------
-- 007: tools/*.js が参照するカラムを 001_init.sql に追加
-- ---------------------------------------------------------------------------
-- 対象カラム（tools 実装側が期待するが 001 に未定義だったもの）:
--   mcp_agents: auto_bid_enabled, max_bid_amount,
--               seller_sentiment_count, buyer_sentiment_count
--   mcp_bids:   message
--   mcp_negotiations: bid_id, round, agent_response, agent_counter_amount,
--                     agent_message, counter_history, expires_at,
--                     human_approval_required, updated_at

-- mcp_agents ──────────────────────────────────────────────────────────────────

ALTER TABLE mcp_agents
  ADD COLUMN IF NOT EXISTS auto_bid_enabled   BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_bid_amount     INTEGER  NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS seller_sentiment_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_sentiment_count  INTEGER NOT NULL DEFAULT 0;

-- mcp_bids ────────────────────────────────────────────────────────────────────

ALTER TABLE mcp_bids
  ADD COLUMN IF NOT EXISTS message TEXT;

-- mcp_negotiations ─────────────────────────────────────────────────────────────

ALTER TABLE mcp_negotiations
  ADD COLUMN IF NOT EXISTS bid_id                  UUID    REFERENCES mcp_bids(id),
  ADD COLUMN IF NOT EXISTS round                   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_response          TEXT    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS agent_counter_amount    INTEGER,
  ADD COLUMN IF NOT EXISTS agent_message           TEXT,
  ADD COLUMN IF NOT EXISTS counter_history         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_approval_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW();
