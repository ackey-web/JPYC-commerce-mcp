-- ---------------------------------------------------------------------------
-- 009: BountyEscrow フロー用テーブル追加
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_bounties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES mcp_tasks(id),
  client_wallet   TEXT NOT NULL,
  amount          INTEGER NOT NULL,               -- JPYC (整数)
  job_key         TEXT UNIQUE,                    -- bytes32 hex (オンチェーン jobKey)
  onchain_job_id  BIGINT,                         -- コントラクト側の uint256 jobId
  status          TEXT NOT NULL DEFAULT 'pending_open',
  -- pending_open → open → assigned → submitted → confirmed → released / auto_released / cancelled / expired
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_bounty_bids (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id         UUID NOT NULL REFERENCES mcp_bounties(id),
  bidder_wallet     TEXT NOT NULL,
  bid_amount        INTEGER NOT NULL,             -- JPYC (整数)
  deliverable_hash  TEXT,                         -- bytes32 hex
  onchain_bid_id    BIGINT,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- pending → accepted / rejected
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- mcp_bounties.onchain_job_id が判明後の照合用インデックス
CREATE INDEX IF NOT EXISTS idx_mcp_bounties_job_key       ON mcp_bounties(job_key);
CREATE INDEX IF NOT EXISTS idx_mcp_bounties_client        ON mcp_bounties(client_wallet);
CREATE INDEX IF NOT EXISTS idx_mcp_bounty_bids_bounty_id  ON mcp_bounty_bids(bounty_id);

COMMENT ON TABLE mcp_bounties IS
  'BountyEscrow コントラクト経由のバウンティフローを管理。status はオンチェーンイベント受信時ではなく MCP tool 呼び出し時に更新。';
COMMENT ON TABLE mcp_bounty_bids IS
  'BountyEscrow.submitBid / acceptBid に対応するオフチェーン入札記録。';
