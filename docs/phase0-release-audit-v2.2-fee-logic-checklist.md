# v2.2 BountyEscrow Fee Logic 監査チェックリスト（事前準備）

- **作成日**: 2026-04-22
- **作成者**: security-qa
- **用途**: team-lead 判断 A（Fee Logic を v2.2 で追加）が確定した場合の再監査項目
- **現状**: HEAD (`2ea68b9` v2.1) 時点で Fee Logic は未実装（`PROTOCOL_FEE_BPS = 0`）
- **確定仕様**（またろ氏の方針）: 0.1% DAO Treasury Fee、2-of-3 Gnosis Safe

## 監査項目（v2.2 実装後に実施）

### F. Fee Logic Constants（4 項目）

#### F-1. `PROTOCOL_FEE_BPS = 10` immutable 固定
```bash
grep -n "PROTOCOL_FEE_BPS" contracts/contracts/BountyEscrow.sol
```
- `uint256 public constant PROTOCOL_FEE_BPS = 10;` である
- `constant` または `immutable` 修飾子付き（set 関数なし）
- 10 basis points = 0.1%（コメントに明記）

#### F-2. `FEE_RECIPIENT` immutable 固定
```bash
grep -n "FEE_RECIPIENT\|feeRecipient" contracts/contracts/BountyEscrow.sol
```
- `address public immutable FEE_RECIPIENT;` である
- constructor で一度だけ設定、以降変更不可
- `setFeeRecipient` や `transferOwnership` 系の変更経路なし

#### F-3. `FEE_RECIPIENT = 0x0` 拒否
- constructor で `require(_feeRecipient != address(0), "Invalid fee recipient")` または同等の revert
- zero address 設定が deploy 時点で拒否される
- Amoy / Mainnet deploy script で Safe アドレスが正しく渡されること（#34 の成果物確認）

#### F-4. constructor 3 引数化
- 既存 2 引数（jpyc, admin）に `feeRecipient` を追加
- deploy script 側も 3 引数化済み（Safe アドレス渡し）
- README / deployment docs 更新反映

### G. `_distributePayout` 内部関数（5 項目）

#### G-1. 算術の正確性（丸め誤差）
- 実装例: `uint256 fee = amount * PROTOCOL_FEE_BPS / 10_000; uint256 workerShare = amount - fee;`
- **整数除算の丸め誤差は fee 側に寄る**（fee が切り捨て、workerShare が残余）→ worker に 1 wei 多く渡る方向で安全
- `amount` が `uint128` で overflow 不可（JPYC は 1e6 max supply 想定、18 decimals = max ~ 10^24 << 2^128）

#### G-2. amount < 10_000 の時 fee = 0 エッジケース
- `amount = 9_999` のとき `fee = 9_999 * 10 / 10_000 = 9` （BPS 演算で 0 にならない、注意）
- 本当に「amount < 10_000 で fee=0」にしたいなら `if (amount < 10_000) fee = 0;` の明示ガードが必要
- **project-leader の指示で「amount < 10_000 で fee = 0 を確認」とあるので、この条件分岐の有無を明示的に確認**
- テストケース: `amount = 9_999` / `10_000` / `10_001` / `10_000_000` （境界値、桁上がり）

#### G-3. cancelBounty で fee ゼロ
- `cancelBounty` 呼び出し時、`_distributePayout` は呼ばれず、`_safeTransfer(client, amount)` で全額返金
- 「OPEN → CANCELLED」遷移なので、fee 取得タイミング（confirmDelivery / claimExpired）を経ていない
- **DAO Treasury に 1 wei も流れないこと** を unit test で確認

#### G-4. 呼び出し経路
`_distributePayout(worker, amount)` が呼ばれる内部関数パス:
- `confirmDelivery` → `_distributePayout`
- `claimExpired` → `_distributePayout`
- **`cancelBounty` では呼ばれない**（上記 G-3）
- 他の経路（admin 操作など）が無いこと

#### G-5. ReentrancyGuard 整合
- `_distributePayout` 内で `_safeTransfer(worker, workerShare)` → `_safeTransfer(FEE_RECIPIENT, fee)` の 2 回転送
- CEI パターン（Checks-Effects-Interactions）厳守: Effects 更新後に転送
- 呼び出し元（confirmDelivery / claimExpired）に `nonReentrant` modifier 適用済みであること

### H. イベント発行（2 項目）

#### H-1. `ProtocolFeeDistributed` イベント定義
```solidity
event ProtocolFeeDistributed(uint64 indexed jobId, address indexed recipient, uint128 amount);
```
- `jobId`, `recipient (= FEE_RECIPIENT)`, `amount (= fee)` を記録
- `indexed` で検索可能

#### H-2. イベント発行タイミング
- `_distributePayout` 内で `emit ProtocolFeeDistributed(jobId, FEE_RECIPIENT, fee);` が確実に発行
- `fee == 0` の場合でも発行するか判断（エッジケース G-2 で 0 になり得る場合）
- 既存の `AutoReleased` / `Released` イベントと併発

### I. テストカバレッジ（3 項目）

#### I-1. テストケース 5〜10 追加
- 正常系: fee 計算 + DAO Treasury 振込 + worker 残余
- エッジ: amount < 10_000 / amount = 10_000 / 非常に大きい amount
- cancelBounty で fee = 0 確認
- event 発行の argument 検証

#### I-2. deploy script 更新
- `contracts/scripts/deploy.js`（or TypeScript）で `feeRecipient` パラメータを受け取る
- Amoy テスト用 EOA と Mainnet 用 2-of-3 Safe の両方で deploy 可能
- ABI export に FEE_RECIPIENT / PROTOCOL_FEE_BPS / ProtocolFeeDistributed を含む

#### I-3. README / deployment docs 更新
- 「FEE_RECIPIENT は immutable、deploy 後変更不可」明記
- 「Fee は 0.1% (10 bps)、ワーカーへの払出で自動徴収」明記
- 「Fee は cancelBounty では発生しない」明記
- 「FEE_RECIPIENT = 2-of-3 Gnosis Safe（Polygon Mainnet）」明記

### J. DAO Safe 2-of-3 構造のドキュメント監査（2 項目）

#### J-1. README 記載確認
以下が README / docs に明記されているか確認:
- **maintainer 単独引出不可**（2-of-3 threshold）
- **運営は手数料直接受取なし**（Safe 経由のみ）
- **Phase 1+ Governance Token 移行ロードマップ**（将来的に Safe を Governance に移行）
- **弁護士レビュー推奨**（Phase 1 前、金融規制・税務影響）

#### J-2. Safe アドレスの公開
- Polygon Mainnet Safe アドレスを README / NOTICE に明記
- Block explorer での検証可能な形式
- 署名者 3 名の公開鍵アドレス（必須ではないが透明性向上のため推奨）

## 再監査時の実行手順

1. v2.2 実装完了を検知（smart-contract-engineer からの通知 or git log で `PROTOCOL_FEE_BPS = 10` 確認）
2. F / G / H / I / J 各項目を順番に実施
3. テストスイート実行（46 → 50+ に増える想定）
4. Slither / Mythril 再実行（user 依頼）
5. 本チェックリストの各項目を `docs/phase0-release-audit-phase2-result.md` に追記 or 別ファイル `-v2.2.md` として発行
6. 最終 GO/NO-GO 通告を project-leader に送信

## 判断 B / C シナリオ

### 判断 B: 0% 維持で方針撤回
- 現在の `5191cf8 GO 判定` がそのまま有効
- 本チェックリストは使用しない
- ただし README から「0.1% DAO Treasury」言及を削除する作業が発生（tokenomics-advisor / community-marketing 側）

### 判断 C: Phase 1+ 延期
- 現在の `5191cf8 GO 判定` がそのまま有効
- 本チェックリストは Phase 1+ 再監査時に使用
- README に「Phase 1+ で Fee Logic 追加予定」と明記

## 監査者メモ

Fee Logic 実装の落とし穴:
1. `amount * 10 / 10_000` の順序（先乗算後除算）を守る。先除算すると小さい amount で fee=0 になる
2. `FEE_RECIPIENT.call{value: fee}("")` のような ether 送金は JPYC では不要（ERC-20 transfer）
3. `ReentrancyGuard` は外部関数に適用、`_distributePayout` は internal なので modifier 不要だが、呼び出し元で適用必須
4. イベントインデックス数は最大 3 つ、4 つ目以降は非 indexed パラメータ
5. immutable と constant の違い: constant = compile-time 固定値、immutable = constructor 内で 1 度設定可能な固定値

---

**security-qa, 2026-04-22**
