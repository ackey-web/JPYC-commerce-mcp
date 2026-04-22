# Phase 0+ 公開前セキュリティ監査 フェーズ 2 チェックリスト（BountyEscrow 組込版）

- **位置付け**: Task #31 (P0-25) のフェーズ 2。フェーズ 1（`phase0-release-audit.md`）の条件付き PASS を確定するための追加監査
- **依存**: #20 (E2E) + #32 (BountyEscrow.sol) + #33 (テストスイート) + #34 (Amoy デプロイ) + #35 (MCP tools 拡張) + #36 (EIP-3009 ヘルパー) 全完了
- **最終 GO/NO-GO**: 本チェックリストの全項目クリアで Phase 0+ 公開可
- **作成**: security-qa、2026-04-22

## フェーズ 2 項目（11 件）

### A. BountyEscrow.sol 静的解析

#### A-1. Slither 実行
```bash
cd contracts
slither contracts/BountyEscrow.sol --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/"
```
- high / critical 警告ゼロ必須
- medium 警告は個別トリアージ（false positive であれば明示）

#### A-2. Mythril 実行（optional、時間許容時）
```bash
myth analyze contracts/BountyEscrow.sol
```
- SWC-101 (Integer overflow)、SWC-107 (Reentrancy)、SWC-104 (Unchecked Call Return) が無いこと

### B. BountyEscrow 設計原則の実装検証

#### B-1. admin withdraw 関数の不在
```bash
grep -n "function.*withdraw\|function.*rescue\|function.*emergency" contracts/contracts/BountyEscrow.sol
```
- オーナー / admin が任意に資金を引き出せる関数が **存在しないこと** を確認
- 期限失効後の自動払出（契約ロジック内の if-else）のみ許容

#### B-2. Upgradeable Proxy 不使用
```bash
grep -n "Initializable\|UUPS\|Upgradeable" contracts/contracts/BountyEscrow.sol
```
- OpenZeppelin の Upgradeable 系を import していないこと
- constructor で全状態を固定し、`immutable` 修飾子を活用していること

#### B-3. pause 関数に timelock 48h 遅延
```bash
grep -n "pause\|Pausable\|timelock\|TIMELOCK" contracts/contracts/BountyEscrow.sol
```
- Pausable を使う場合、`pause()` は即時でなく **48 時間の timelock 経由**で発効すること
- または pause が存在せず、一切の管理者介入を排除していること（より推奨）

#### B-4. 期限失効時の自動払出
- `release()` / `refund()` / `expire()` 相当の関数が、deadline 超過後に誰でも呼べること（permissionless）
- 資金ロックが起きないフェイルセーフ

#### B-5. EIP-3009 nonce 再利用攻撃耐性
- JPYC v2 の `authorizationState(from, nonce)` を呼び出して既使用チェック or 契約内 mapping で管理
- transferWithAuthorization を受け取る関数で nonce uniqueness を強制

#### B-6. Reentrancy 耐性
```bash
grep -n "ReentrancyGuard\|nonReentrant" contracts/contracts/BountyEscrow.sol
```
- `@openzeppelin/contracts/security/ReentrancyGuard.sol` を import
- 外部呼び出しを行う関数（release、refund 等）に `nonReentrant` modifier 適用

#### B-7. protocolFeeBps = 0 immutable
```bash
grep -n "protocolFeeBps\|PROTOCOL_FEE" contracts/contracts/BountyEscrow.sol
```
- `uint256 public constant PROTOCOL_FEE_BPS = 0;` または `immutable` でゼロ固定
- 後から変更可能な setter 関数が存在しないこと

### C. EIP-3009 / Relayer 層のシークレット漏洩チェック

#### C-1. `lib/eip3009.js` 検査
```bash
cat lib/eip3009.js | grep -iE "private_key|PRIVATE_KEY|secret|signWith|privateToAddress"
```
- 秘密鍵を引数で受け取らないこと
- EIP-712 typed-data 生成のみを行い、署名自体はユーザー側で実施

#### C-2. `lib/relayerClient.js` 検査
```bash
cat lib/relayerClient.js | grep -iE "console\.log.*key|console\.log.*secret|process\.env\..*KEY"
```
- `RELAYER_API_KEY` を `Authorization` ヘッダ経由でのみ使用（ログ出力禁止）
- 失敗時のエラーメッセージに API キー値を含めないこと

#### C-3. env var 公開スキャン
```bash
grep -rn "RELAYER_API_KEY\|RELAYER_URL" --include="*.js" --include="*.md" .
```
- `.env.example` にはプレースホルダのみ
- README に記述がある場合、実値の例示が無いこと

### D. MCP tools 拡張（openBounty / acceptBid 等）

#### D-1. 新規ツールの calldata-only 原則
- 各新規ツール（openBounty, acceptBid, submitWork, releaseBounty 等）が **calldata** または **typed-data** のみを返すこと
- 秘密鍵を引数で受け取らないこと
- 送金の最終署名は呼び出し側（ユーザーエージェント）の責任

#### D-2. DB 書き込みタイミング
- オンチェーン tx 送信**前** に DB へ pending 記録
- tx hash を reportTxHash 相当のツールで後日更新する設計
- Rezona の socket-handlers 教訓を踏襲（try-catch 必須）

#### D-3. 入力検証
- wallet address の EIP-55 チェックサム検証（既存 tools の踏襲）
- 金額上限・有効期限・bid 額のサニティチェック

### E. 最終 GO/NO-GO 通告

#### E-1. Phase 1 + Phase 2 全項目 PASS 確認
- `docs/phase0-release-audit.md`（Phase 1、既に条件付き PASS）
- 本レポートの A〜D 全項目 PASS

#### E-2. Amoy テストネット E2E 通し確認（Task #20 成果の引継ぎ）
- `scripts/preflight-check.js` 実行で環境健全
- 14/14 E2E テスト pass（`a13d7ed` で達成済）

#### E-3. 公開可否判定
- 全項目 PASS → **GO**
- いずれか FAIL → 担当エージェントに差し戻し、修正後再監査

## 進め方

1. `#32`, `#36` 完了を待って A〜C を並行実施
2. `#35` 完了で D 実施
3. `#34`（Amoy デプロイ）完了で E-2 最終確認
4. E-3 で最終 GO/NO-GO を project-leader に通告

## 参考リソース

- **Slither**: https://github.com/crytic/slither
- **Mythril**: https://github.com/ConsenSys/mythril
- **EIP-3009**: https://eips.ethereum.org/EIPS/eip-3009
- **OpenZeppelin ReentrancyGuard**: `@openzeppelin/contracts/security/ReentrancyGuard.sol`
- **JPYC v2 仕様**: （公式ドキュメント参照）
