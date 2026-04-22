-- ---------------------------------------------------------------------------
-- 006: mcp_negotiations 状態マシン対応カラム追加
-- ---------------------------------------------------------------------------

ALTER TABLE mcp_negotiations
  ADD COLUMN IF NOT EXISTS bid_id            UUID,
  ADD COLUMN IF NOT EXISTS round            INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_response   TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS agent_counter_amount INTEGER,
  ADD COLUMN IF NOT EXISTS agent_message    TEXT,
  ADD COLUMN IF NOT EXISTS counter_history  JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_approval_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- status 値を拡張: pending / countered / accepted / rejected / expired / paid / completed
-- (existing 'approved' は 'accepted' に統一、移行)
UPDATE mcp_negotiations SET status = 'accepted' WHERE status = 'approved';

COMMENT ON COLUMN mcp_negotiations.status IS
  'pending | countered | accepted | rejected | expired | paid | completed';
COMMENT ON COLUMN mcp_negotiations.counter_history IS
  'JSON array of {round, proposed, counter, ts} for audit trail';
COMMENT ON COLUMN mcp_negotiations.expires_at IS
  'NULL = no expiry. Lazy-checked on every respond_to_offer call.';

CREATE INDEX IF NOT EXISTS idx_mcp_negotiations_expires
  ON mcp_negotiations(expires_at) WHERE expires_at IS NOT NULL;
