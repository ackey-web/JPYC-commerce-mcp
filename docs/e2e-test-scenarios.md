# E2E テストシナリオ（P0-18）

Phase 0+ 完了判定用。Amoy testnet + Neon DB を使った実エージェント間フロー検証。

## 前提条件

| 項目 | 値 |
|---|---|
| ネットワーク | Polygon Amoy testnet |
| JPYC コントラクト | `.env` の `JPYC_CONTRACT_ADDRESS`（Amoy テスト用） |
| SBT コントラクト | `.env` の `SBT_CONTRACT_ADDRESS`（smart-contract-engineer デプロイ済み） |
| DB | Neon（`DATABASE_URL` 設定済み） |
| エージェント A | クライアント（発注側）ウォレット: `AGENT_A_WALLET` |
| エージェント B | 受注側ウォレット: `AGENT_B_WALLET` |

## Fixtures（テスト用ダミーデータ）

```js
// test/fixtures.js
export const AGENT_A = {
  wallet: '0xAAAA000000000000000000000000000000000001',
  agent_id: '00000000-0000-0000-0000-000000000001',
};
export const AGENT_B = {
  wallet: '0xBBBB000000000000000000000000000000000002',
  agent_id: '00000000-0000-0000-0000-000000000002',
};
export const SAMPLE_TASK = {
  title: 'Solidity コントラクトのセキュリティ監査',
  description: 'ERC-20 トークンコントラクト 300 行の監査レポート作成',
  skills: ['Solidity', 'DeFi', 'Foundry'],
  deadline_days: 7,
};
export const SAMPLE_JPYC_AMOUNT = 500; // JPYC（Silver ランク自動承認上限内）
```

---

## シナリオ 1: 基本取引フロー（ハッピーパス）

### ステップ 1: エージェント登録・プロフィール取得

```bash
# A・B 両エージェントのプロフィール初期化
mcp call get_sbt_profile '{"wallet_address": "0xAAAA...0001"}'
mcp call get_sbt_profile '{"wallet_address": "0xBBBB...0002"}'
```

**検証項目:**
- [ ] 新規エージェントが `mcp_agents` に INSERT される
- [ ] `trust_score: 0`, `rank: "Bronze"` が返る
- [ ] `onchain.hasSbt: false` が返る（SBT 未発行）

---

### ステップ 2: タスク査定

```bash
mcp call evaluate_task '{
  "title": "Solidity コントラクトのセキュリティ監査",
  "description": "ERC-20 トークンコントラクト 300 行の監査レポート作成",
  "skills": ["Solidity", "DeFi", "Foundry"],
  "deadline_days": 7
}'
```

**検証項目:**
- [ ] `difficulty_score` が 0〜1 の範囲で返る
- [ ] `reward_min` / `reward_max` (JPYC) が正の整数で返る
- [ ] `scoring_method: "formula_only"` が返る

---

### ステップ 3: 交渉提案（A → B）

```bash
mcp call propose_negotiation '{
  "from_agent_wallet": "0xAAAA...0001",
  "to_agent_wallet": "0xBBBB...0002",
  "task_title": "Solidity コントラクトのセキュリティ監査",
  "offered_jpyc": 500,
  "deadline_days": 7,
  "message": "監査レポートをお願いしたいです"
}'
```

**検証項目:**
- [ ] `mcp_negotiations` に negotiation レコードが INSERT される
- [ ] `negotiation_id` が UUID 形式で返る
- [ ] `status: "pending"` が返る
- [ ] 有効期限（`expires_at`）が現在時刻 + N 時間以内で設定される

---

### ステップ 4: 交渉応答（B が承諾）

```bash
mcp call respond_to_offer '{
  "negotiation_id": "<step3で取得したID>",
  "responder_wallet": "0xBBBB...0002",
  "response": "accept",
  "counter_jpyc": null
}'
```

**検証項目:**
- [ ] negotiation `status` が `"accepted"` に更新される
- [ ] `auto_approved: true` が返る（500 JPYC < Silver 上限 500 JPYC、境界値）
  - ※ 501 JPYC の場合は `human_approval_required: true` になることも確認
- [ ] `mcp_orders` に注文レコードが作成される

---

### ステップ 5: 人間承認（閾値超過ケース）

500 JPYC 超で人間承認が必要なケースを別途テスト:

```bash
mcp call request_human_approval '{
  "negotiation_id": "<threshold超過のID>",
  "amount_jpyc": 1500,
  "requester_wallet": "0xAAAA...0001"
}'
```

**検証項目:**
- [ ] `approval_required: true` が返る
- [ ] デモモード（`DEMO_MODE=true`）で自動スキップされないことを確認（SEC-3）
- [ ] `mcp_platform_config.human_approval_threshold_jpyc` の値が閾値として使われる

---

### ステップ 6: JPYC 送金 calldata 生成

```bash
mcp call execute_payment '{
  "negotiation_id": "<acceptedのID>",
  "payer_wallet": "0xAAAA...0001"
}'
```

**検証項目:**
- [ ] `calldata` が返る（16進数文字列）
- [ ] `to` が JPYC コントラクトアドレス
- [ ] `value: 0`（ERC-20 transfer は ETH value = 0）
- [ ] MCP が秘密鍵を持たず署名しないことを確認（ノンカストディアル原則）
- [ ] calldata を Amoy でブロードキャストすると JPYC 転送が成功する

---

### ステップ 7: 納品確認・エスクロー解放

```bash
mcp call confirm_delivery '{
  "order_id": "<step4で作成されたorder_id>",
  "buyer_wallet": "0xAAAA...0001",
  "satisfaction": 0.9
}'
```

**検証項目:**
- [ ] `calldata` が返る（JPYC transfer to seller）
- [ ] `order.status` が `"delivered"` に更新される

---

### ステップ 8: SBT 更新（信頼スコア更新 + calldata 生成）

```bash
mcp call update_agent_record '{
  "agent_id": "<B の agent_id>",
  "task_id": "<task_id>",
  "task_result": "completed",
  "sentiment": 0.9
}'
```

**検証項目:**
- [ ] `trust_score` が更新される（0 → 正の値）
- [ ] `unique_counterparty_count` が更新される（Diversity V4）
- [ ] `onchain.action` が `"mint"` で返る（SBT 未発行のため）
- [ ] `onchain.calldata` が有効な hex 文字列
- [ ] `onchain.merkleRoot` が 0x 始まりの 32 バイト hex
- [ ] calldata を Amoy でブロードキャストすると SBT が mint される

---

### ステップ 9: SBT プロフィール確認（オンチェーン検証）

```bash
mcp call get_sbt_profile '{"wallet_address": "0xBBBB...0002"}'
```

**検証項目:**
- [ ] `onchain.hasSbt: true` が返る
- [ ] `onchain.locked: true`（ERC-5192 locked）
- [ ] `rank` が `trust_score` に対応するランクになっている
- [ ] `onchain.tokenURI` が data URI または IPFS URI
- [ ] `onchain.onChainMerkleRoot` が `update_agent_record` で返した merkleRoot と一致

---

## シナリオ 2: エッジケース

### 2-A: キャンセル（クライアント側）

```bash
mcp call update_agent_record '{
  "task_result": "cancelled_by_client",
  ...
}'
```

**検証項目:**
- [ ] `trust_score` に影響がない（`message: "発注側キャンセル: エージェントスコアに影響なし"` が返る）

### 2-B: タイムアウト・失敗

```bash
mcp call update_agent_record '{
  "task_result": "failed",
  ...
}'
```

**検証項目:**
- [ ] `trust_score` が下がる（または維持される）
- [ ] `recent_failure_rate` が正しく計算される（SEC-1 修正済み）

### 2-C: 同一エージェント間の繰り返し取引（Sybil 攻撃シミュレーション）

同じ A-B ペアで 10 回取引を繰り返す:

**検証項目:**
- [ ] `unique_counterparty_count` が増加しない（1 のまま）
- [ ] Diversity Factor により `trust_score` の上昇が抑制される

---

## シナリオ 3: Merkle Root コミット

```bash
node scripts/commitMerkleRoot.js
```

**検証項目:**
- [ ] Neon DB から全エージェントスコアを取得
- [ ] Merkle Tree が構築される
- [ ] `commitRoot(root)` の calldata が生成される
- [ ] Amoy で送信後、`mcp_merkle_commits` テーブルに記録される
- [ ] `mcp_trust_snapshots` テーブルが存在する場合は INSERT される（42P01 でスキップも可）

---

## 実行チェックリスト（P0-18 完了判定）

- [ ] シナリオ 1 ハッピーパス: 全ステップ通過
- [ ] シナリオ 2-A キャンセル: スコア不変を確認
- [ ] シナリオ 2-B 失敗: failure_rate 反映を確認
- [ ] シナリオ 2-C Sybil: Diversity Factor 抑制を確認
- [ ] シナリオ 3 Merkle Root: Amoy コミット成功
- [ ] SBT mint の Amoy 疎通（smart-contract-engineer デプロイアドレス必須）
- [ ] JPYC 送金 calldata の Amoy ブロードキャスト成功

全項目チェック完了 → Task #20 (P0-18) completed
