-- Migration 004: mcp_merkle_commits テーブル作成
-- Merkle Root コミットの履歴を記録する
-- 実行: P0-07 (Neon 移行) 完了後に Neon DB で実行

CREATE TABLE IF NOT EXISTS mcp_merkle_commits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Merkle Root (bytes32 hex、0x プレフィクス付き)
  merkle_root       text        NOT NULL,

  -- このコミット時点のエージェント総数
  agent_count       integer     NOT NULL DEFAULT 0,

  -- 成功・失敗の内訳
  success_count     integer     NOT NULL DEFAULT 0,
  fail_count        integer     NOT NULL DEFAULT 0,

  -- チェーン (137=mainnet, 80002=amoy)
  chain_id          integer     NOT NULL DEFAULT 80002,

  -- コミット日時
  committed_at      timestamptz NOT NULL DEFAULT now(),

  -- 各エージェントごとの詳細 (JSON)
  -- [{wallet_address, token_id, tx_hash, block_number, success, error?}]
  agent_details     jsonb       NOT NULL DEFAULT '[]'::jsonb
);

-- 最新コミットをすばやく取得するためのインデックス
CREATE INDEX IF NOT EXISTS idx_merkle_commits_committed_at
  ON mcp_merkle_commits (committed_at DESC);

-- チェーン別の最新コミット取得用
CREATE INDEX IF NOT EXISTS idx_merkle_commits_chain_committed
  ON mcp_merkle_commits (chain_id, committed_at DESC);

-- Merkle Root の重複確認用（同じルートの二重コミット防止）
CREATE INDEX IF NOT EXISTS idx_merkle_commits_root
  ON mcp_merkle_commits (merkle_root);

COMMENT ON TABLE mcp_merkle_commits IS
  'TrustSBT コントラクトへの信頼スコア Merkle Root コミット履歴';
COMMENT ON COLUMN mcp_merkle_commits.merkle_root IS
  'bytes32 hex (0x プレフィクス付き)、全エージェントの信頼スコアツリーのルート';
COMMENT ON COLUMN mcp_merkle_commits.agent_details IS
  '各エージェントのコミット結果 [{wallet_address, token_id, tx_hash, block_number, success, error?}]';
