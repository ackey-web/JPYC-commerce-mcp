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

---

## シナリオ B: BountyEscrow フロー（P0-18 拡張）

EIP-3009 ガスレス入金 + BountyEscrow オンチェーンエスクロー経由のフル取引。3サブシナリオで全状態遷移を網羅する。

### 前提条件（シナリオ B 共通）

| 項目 | 値 |
|---|---|
| BountyEscrow コントラクト | `.env` の `BOUNTY_ESCROW_ADDRESS`（Amoy デプロイ済み） |
| job_key | `keccak256(agentA.wallet + timestamp)` 形式の bytes32 |
| JPYC 残高 | エージェント A のウォレットに 600 JPYC 以上（Amoy テスト用 JPYC） |

---

## シナリオ B-1: 正常系（openBounty → confirmDelivery → SBT 更新）

`OPEN → ASSIGNED → SUBMITTED → RELEASED` のハッピーパス。

### B-1-1: バウンティ開設（openBounty + EIP-3009 入金）

```bash
mcp call open_bounty '{
  "poster_wallet": "0xAAAA...0001",
  "task_title": "Solidity コントラクトのセキュリティ監査",
  "amount_jpyc": 500,
  "deadline_days": 7
}'
```

**検証項目:**
- [ ] `job_key` (bytes32) が返る
- [ ] `open_calldata` に `openBounty` セレクタ `0xdf6814f6` が含まれる
- [ ] `deposit_typed_data` に EIP-712 `TransferWithAuthorization` typed data が含まれる
- [ ] `domain.name: "JPY Coin"`, `domain.chainId: 80002` が正しい
- [ ] A がオフチェーン署名 → `depositWithAuthorization` ブロードキャスト → Amoy でトランザクション成功
- [ ] `jobs[jobKey].status == OPEN(1)` を確認

---

### B-1-2: 入札（submitBid）

```bash
mcp call submit_bid '{
  "job_key": "<B-1-1で取得したjob_key>",
  "bidder_wallet": "0xBBBB...0002",
  "bid_amount_jpyc": 480
}'
```

**検証項目:**
- [ ] `calldata` に `submitBid` セレクタ `0xce677693` が含まれる
- [ ] B がブロードキャスト → Amoy でトランザクション成功
- [ ] `jobs[jobKey].bidCount == 1` を確認

---

### B-1-3: 入札承認（acceptBid）

```bash
mcp call accept_bid '{
  "job_key": "<job_key>",
  "acceptor_wallet": "0xAAAA...0001",
  "bid_index": 0
}'
```

**検証項目:**
- [ ] `calldata` に `acceptBid` セレクタ `0x09dfd4b7` が含まれる
- [ ] A がブロードキャスト → Amoy でトランザクション成功
- [ ] `jobs[jobKey].status == ASSIGNED(2)` を確認
- [ ] `jobs[jobKey].worker == 0xBBBB...0002` を確認

---

### B-1-4: 成果物提出（submitDeliverable）

```bash
mcp call submit_deliverable '{
  "job_key": "<job_key>",
  "worker_wallet": "0xBBBB...0002",
  "deliverable_hash": "0xdeadbeef..."
}'
```

**検証項目:**
- [ ] `calldata` に `submitDeliverable` セレクタ `0xd46600aa` が含まれる
- [ ] B がブロードキャスト → `jobs[jobKey].status == SUBMITTED(3)` を確認

---

### B-1-5: 納品確認・エスクロー解放（confirmDelivery）

```bash
mcp call confirm_delivery_bounty '{
  "job_key": "<job_key>",
  "buyer_wallet": "0xAAAA...0001"
}'
```

**検証項目:**
- [ ] `calldata` に `confirmDelivery` セレクタ `0x74950ffd` が含まれる
- [ ] A がブロードキャスト → `jobs[jobKey].status == RELEASED(4)` を確認
- [ ] B の JPYC 残高が入札額（480 JPYC）増加していることを確認
- [ ] `BountyReleased` イベントが emit されていることを確認

---

### B-1-6: SBT 更新（BountyEscrow 完了後）

```bash
mcp call update_agent_record '{
  "agent_id": "<B の agent_id>",
  "task_id": "<job_key をタスクIDとして記録>",
  "task_result": "completed",
  "sentiment": 0.85
}'
```

**検証項目:**
- [ ] B の `trust_score` が上昇する
- [ ] `unique_counterparty_count` が更新される
- [ ] `onchain.calldata` が有効な hex 文字列
- [ ] calldata を Amoy でブロードキャスト → SBT の `updateScore()` 成功

---

## シナリオ B-2: 期限失効系（openBounty → 90日経過 → claimExpired → SBT 更新）

クライアントが confirmDelivery を呼ばない場合、ワーカーが 90 日後に `claimExpired` で資金を引き出す。

### B-2-1〜B-2-4: B-1-1〜B-1-4 と同じ手順で SUBMITTED 状態まで進める

### B-2-5: 期限失効（claimExpired）

> 実 Amoy での E2E テストでは 90 日待機は不現実なため、ローカルの Hardhat テスト（`BountyEscrow.test.js`）でカバー済み。Amoy では `block.timestamp` を操作できないため手動検証は省略可。

```bash
mcp call claim_expired '{
  "job_key": "<SUBMITTED状態のjob_key>",
  "worker_wallet": "0xBBBB...0002"
}'
```

**検証項目:**
- [ ] `calldata` に `claimExpired` セレクタ `0xb16e1343` が含まれる
- [ ] Hardhat テストで `time.increase(90 * 24 * 3600 + 1)` 後に呼び出すと成功
- [ ] `jobs[jobKey].status == AUTO_RELEASED(5)` を確認（Hardhat）
- [ ] ワーカー B の JPYC 残高が増加することを確認（Hardhat）
- [ ] 90 日前に `claimExpired` を呼ぶと `revert NotExpired` になることを確認（Hardhat）

### B-2-6: SBT 更新（claimExpired 後）

```bash
mcp call update_agent_record '{
  "task_result": "completed",
  "sentiment": 0.5
}'
```

**検証項目:**
- [ ] `trust_score` が更新される（期限失効でも完了扱い）

---

## シナリオ B-3: キャンセル系（openBounty → 誰も応札しない → cancelBounty → 資金返却）

OPEN 状態のデッドロック解消。誰も応札しない場合にポスターが自己返金する。

### B-3-1: バウンティ開設（B-1-1 と同じ）

新たな job_key でバウンティを開設する（応札者なし）。

**検証項目:**
- [ ] `jobs[jobKey].status == OPEN(1)` を確認

---

### B-3-2: キャンセル（cancelBounty）

```bash
mcp call cancel_bounty '{
  "job_key": "<OPEN状態のjob_key>",
  "poster_wallet": "0xAAAA...0001"
}'
```

**検証項目:**
- [ ] `calldata` に `cancelBounty` セレクタが含まれる
- [ ] A がブロードキャスト → Amoy でトランザクション成功
- [ ] `jobs[jobKey].status == CANCELLED(6)` を確認
- [ ] A の JPYC 残高が元の入金額（500 JPYC）分返還されていることを確認
- [ ] `BountyCancelled` イベントが emit されていることを確認

---

### B-3-3: エラーケース確認

**検証項目:**
- [ ] ワーカー B（非ポスター）が `cancelBounty` を呼ぶと `revert NotPoster` になることを確認
- [ ] ASSIGNED 状態（B-1-3 完了後）で `cancelBounty` を呼ぶと `revert InvalidStatus` になることを確認
- [ ] SUBMITTED 状態で `cancelBounty` を呼ぶと `revert InvalidStatus` になることを確認


---

## シナリオ C: Hardhat local フル E2E（Amoy デプロイ後回し対応）

> **方針変更（2026-04-22）**: またろ氏の判断により Amoy 実デプロイを後回しにし、Hardhat local 統合テストで Phase 0+ 完了判定とする。
> テスト実装ファイル: `contracts/test/integration/fullFlow.test.js`（smart-contract-engineer + backend-engineer 作成予定）

Hardhat local ノード上で MockJPYC + TrustSBT + BountyEscrow をデプロイし、SBT mint → BountyEscrow フロー → Merkle Root commit の全チェーンを統合検証する。

### 前提条件（シナリオ C 固有）

| 項目 | 値 |
|---|---|
| 実行環境 | `npx hardhat test` （ローカル Hardhat ノード） |
| MockJPYC | `contracts/test/helpers/MockERC20.sol` または同等品 |
| TrustSBT | `contracts/contracts/TrustSBT.sol`（Amoy デプロイアドレス不要） |
| BountyEscrow | `contracts/contracts/BountyEscrow.sol` v2.1（PROTOCOL_FEE_BPS=0） |
| DB | Neon 実接続（`DATABASE_URL` 設定済み）または pg-mem モック |

---

### C-1: コントラクトデプロイ（Hardhat local）

```js
// fullFlow.test.js 冒頭
const MockJPYC = await ethers.deployContract('MockERC20', ['JPY Coin', 'JPYC', 18]);
const TrustSBT  = await ethers.deployContract('TrustSBT', [owner.address]);
const BountyEscrow = await ethers.deployContract('BountyEscrow', [
  MockJPYC.target, TrustSBT.target, owner.address
]);
```

**検証項目:**
- [ ] 3 コントラクトのデプロイが成功する
- [ ] `BountyEscrow.jpycToken()` が MockJPYC アドレスを返す
- [ ] `BountyEscrow.PROTOCOL_FEE_BPS()` が `0` を返す（Phase 0+ = 0% fee）

---

### C-2: SBT mint（TrustSBT.mint）

```js
await TrustSBT.connect(owner).mint(agentB.address, 0); // tokenId=0, initialScore=0
```

**検証項目:**
- [ ] `TrustSBT.ownerOf(0)` が agentB.address を返す
- [ ] `TrustSBT.locked(0)` が `true` を返す（ERC-5192 non-transferable）
- [ ] `TrustSBT.getScore(0)` が `0` を返す
- [ ] MCP の `update_agent_record` calldata をブロードキャストすると `TrustSBT.updateScore()` が成功する

---

### C-3: BountyEscrow フル統合（openBounty → confirmDelivery）

B-1 と同じフロー、ただし Hardhat local コントラクト + MockJPYC で完結:

```js
// MockJPYC を agentA に配布
await MockJPYC.mint(agentA.address, ethers.parseUnits('1000', 18));
await MockJPYC.connect(agentA).approve(BountyEscrow.target, ethers.parseUnits('500', 18));

// openBounty
const jobKey = ethers.keccak256(ethers.toUtf8Bytes('job-001'));
await BountyEscrow.connect(agentA).openBounty(jobKey, ethers.parseUnits('500', 18));
```

**検証項目:**
- [ ] `openBounty` → `submitBid` → `acceptBid` → `submitDeliverable` → `confirmDelivery` が順に成功
- [ ] `confirmDelivery` 後、agentB の JPYC 残高が +500（Phase 0+ fee ゼロのため全額）
- [ ] `jobs[jobKey].status == RELEASED` を確認
- [ ] `cancelBounty` (OPEN 状態) → `CANCELLED` + agentA 全額返金を確認
- [ ] `claimExpired` (time.increase 後) → `AUTO_RELEASED` + agentB 全額受取を確認

---

### C-4: SBT trust_score 更新 + Merkle Root commit

```js
// MCP update_agent_record → TrustSBT.updateScore calldata を Hardhat で実行
await TrustSBT.connect(owner).updateScore(0, newScore, newMerkleRoot);
```

**検証項目:**
- [ ] `TrustSBT.getScore(0)` が更新後スコアを返す
- [ ] `TrustSBT.merkleRoot()` が新しい Merkle Root を返す
- [ ] `scripts/commitMerkleRoot.js` が Hardhat ノードに向けて正常実行される（`POLYGON_RPC_URL=http://127.0.0.1:8545`）
- [ ] `mcp_merkle_commits` テーブルにコミット記録が INSERT される

---

### C-5: DB + コントラクト整合性確認

**検証項目:**
- [ ] Neon DB の `mcp_agents.trust_score` と `TrustSBT.getScore(tokenId)` が一致する
- [ ] `verify_trust_score` MCP tool が Merkle Proof を正しく検証する
- [ ] Merkle Root が Neon DB と TrustSBT コントラクト両方で一致する

---

## シナリオ D: SBT ↔ BountyEscrow ↔ Merkle Root 連携（agent-to-agent.test.js 拡張）

> テスト実装ファイル: `tests/agent-to-agent.test.js`（既存ファイルへの拡張）

Hardhat local ノード + Neon DB（または pg-mem）を組み合わせた、MCP ツール経由のエージェント間完全フロー。

### D-1: エージェント登録 → BountyEscrow 開設

```bash
# MCP tool 経由
mcp call get_sbt_profile '{"wallet_address": "0xAAAA...0001"}'
mcp call open_bounty '{"poster_wallet": "0xAAAA...0001", "amount_jpyc": 500}'
```

**検証項目:**
- [ ] `mcp_agents` に Agent A/B が登録される
- [ ] `open_bounty` が `job_key` と `open_calldata` を返す
- [ ] calldata を Hardhat local へブロードキャスト → `BountyEscrow.jobs[jobKey].status == OPEN`

---

### D-2: 入札 → 承認 → 成果物提出 → 納品確認

```bash
mcp call submit_bid '{"job_key": "<jobKey>", "bidder_wallet": "0xBBBB...0002", "bid_amount_jpyc": 480}'
mcp call accept_bid '{"job_key": "<jobKey>", "acceptor_wallet": "0xAAAA...0001", "bid_index": 0}'
mcp call submit_deliverable '{"job_key": "<jobKey>", "worker_wallet": "0xBBBB...0002", "deliverable_hash": "0xabc..."}'
mcp call confirm_delivery_bounty '{"job_key": "<jobKey>", "buyer_wallet": "0xAAAA...0001"}'
```

**検証項目:**
- [ ] 各 MCP tool が有効な calldata を返す（セレクタ `0xce677693` / `0x09dfd4b7` / `0xd46600aa` / `0x74950ffd`）
- [ ] Hardhat local ブロードキャスト後、状態遷移が OPEN → ASSIGNED → SUBMITTED → RELEASED
- [ ] Agent B の JPYC 残高が +480（fee ゼロ、全額）増加

---

### D-3: SBT 更新 + Merkle Root commit

```bash
mcp call update_agent_record '{"agent_id": "<B>", "task_result": "completed", "sentiment": 0.85}'
node scripts/commitMerkleRoot.js  # Hardhat ノード向け
```

**検証項目:**
- [ ] `update_agent_record` が `onchain.calldata` を返す
- [ ] calldata を Hardhat local でブロードキャスト → `TrustSBT.updateScore()` 成功
- [ ] `commitMerkleRoot.js` 実行後、`TrustSBT.merkleRoot()` が更新される
- [ ] `mcp_merkle_commits` テーブルにコミット記録が INSERT される
- [ ] DB `trust_score` とオンチェーン `getScore()` が一致する

---

---

## 実行チェックリスト（P0-18 完了判定）

> **方針変更（2026-04-22）**: Amoy 実デプロイを後回しにし、Hardhat local 統合テストで Phase 0+ 完了判定とする。

### Neon DB 疎通（完了済み）
- [x] シナリオ 1 ハッピーパス: 14/14 pass（commit a13d7ed）
- [x] シナリオ 2-A キャンセル: スコア不変を確認
- [x] シナリオ 2-B 失敗: failure_rate 反映を確認
- [x] シナリオ 2-C Sybil: Diversity Factor 抑制を確認
- [x] シナリオ 3 Merkle Root: calldata 生成確認

### BountyEscrow Hardhat テスト（完了済み）
- [x] シナリオ B-1 正常系: OPEN → RELEASED（54テスト pass、commit 2ea68b9）
- [x] シナリオ B-2 期限失効系: claimExpired → AUTO_RELEASED（Hardhat time.increase）
- [x] シナリオ B-3 キャンセル系: cancelBounty → CANCELLED + revert ガード

### Hardhat local 統合 E2E（Phase 0+ 完了判定）
- [ ] シナリオ C-1〜C-5: MockJPYC + TrustSBT + BountyEscrow フル統合 pass
- [ ] シナリオ D-1〜D-3: MCP tools ↔ Hardhat ↔ Neon DB 連携 pass
- [ ] `contracts/test/integration/fullFlow.test.js` 全テスト pass

### Amoy 実ブロードキャスト（Phase 0+ 完了後にオプション実施）
- [ ] SBT コントラクト Amoy デプロイ（deploy script commit 3d14da5 準備済み）
- [ ] BountyEscrow v2.1 Amoy デプロイ（BOUNTY_ESCROW_ADDRESS_AMOY 設定後）
- [ ] Amoy 実ブロードキャストで E2E 疎通確認

Hardhat local 統合 E2E 全項目チェック完了 → Task #20 (P0-18) completed
