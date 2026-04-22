# BountyEscrow — Amoy デプロイ手順

## 前提条件

| 項目 | 内容 |
|------|------|
| Node.js | v18 以上 |
| ネットワーク | Polygon Amoy testnet (chainId 80002) |
| MATIC 残高 | デプロイアカウントに Amoy MATIC が必要（[Faucet](https://faucet.polygon.technology/)） |
| JPYC テストトークン | Amoy 上に MockJPYC をデプロイ済み、または既存アドレスを使用 |

---

## 1. セットアップ

```bash
cd contracts
npm install        # 初回のみ
```

`.env` を作成（`.env.example` をコピーして編集）:

```bash
cp ../.env.example ../.env
```

最低限必要な変数:

```dotenv
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
PRIVATE_KEY=0x<デプロイヤーの秘密鍵>
JPYC_ADDRESS_AMOY=0x<MockJPYC または Amoy 上の JPYC アドレス>
# 省略時はデプロイアカウントが admin になる
# BOUNTY_ADMIN_ADDRESS=0x<admin EOA>
```

---

## 2. MockJPYC デプロイ（Amoy 上に JPYC がない場合）

```bash
npx hardhat run scripts/deployMockJPYC.js --network amoy
```

出力された `MockJPYC` アドレスを `.env` の `JPYC_ADDRESS_AMOY` に設定する。

> MockJPYC は **テスト専用**。mainnet には絶対にデプロイしない。

---

## 3. BountyEscrow デプロイ

```bash
npx hardhat run scripts/deployBountyEscrow.js --network amoy
```

成功時の出力例:

```
Network: amoy (chainId: 80002)
Deployer: 0x1234...
Balance: 0.5 MATIC

Deploying BountyEscrow...
BountyEscrow deployed: 0xAbCd...
Tx hash: 0xdeadbeef...

--- Post-deploy state ---
jpyc:              0x<MockJPYC>
admin:             0x1234...
PROTOCOL_FEE_BPS:  0
CLAIM_TIMEOUT:     7776000 seconds (90 days)
PAUSE_TIMELOCK:    172800 seconds (48 hours)

Deployment record saved: contracts/deployments/bounty-escrow-80002.json

Explorer: https://amoy.polygonscan.com/address/0xAbCd...
Verify: npx hardhat verify --network amoy 0xAbCd... <jpyc> <admin>

Add to .env:
  BOUNTY_ESCROW_ADDRESS_AMOY=0xAbCd...
```

---

## 4. .env を更新

```dotenv
BOUNTY_ESCROW_ADDRESS_AMOY=0xAbCd...
```

---

## 5. コントラクト検証（オプション）

Polygonscan Amoy に ABI とソースコードを公開する場合:

1. `hardhat.config.js` に `POLYGONSCAN_API_KEY` が設定されていることを確認
2. 実行:

```bash
npx hardhat verify --network amoy \
  0xAbCd... \
  <JPYC_ADDRESS> \
  <ADMIN_ADDRESS>
```

---

## 6. デプロイ後の確認

```bash
# Hardhat console で確認
npx hardhat console --network amoy
```

```js
const BountyEscrow = await ethers.getContractFactory("BountyEscrow");
const escrow = BountyEscrow.attach("0xAbCd...");
await escrow.jpyc();         // → JPYC アドレス
await escrow.admin();        // → admin アドレス
await escrow.PROTOCOL_FEE_BPS(); // → 0n
await escrow.CLAIM_TIMEOUT();    // → 7776000n (90日)
await escrow.jobCount();         // → 0n
```

---

## 7. デプロイ記録

デプロイスクリプトは `contracts/deployments/bounty-escrow-{chainId}.json` に以下を保存する:

```json
{
  "network": "amoy",
  "chainId": 80002,
  "contract": "BountyEscrow",
  "address": "0xAbCd...",
  "txHash": "0xdeadbeef...",
  "deployer": "0x1234...",
  "constructorArgs": {
    "jpyc": "0x<MockJPYC>",
    "admin": "0x1234..."
  },
  "constants": {
    "PROTOCOL_FEE_BPS": 0,
    "CLAIM_TIMEOUT_SECONDS": 7776000,
    "PAUSE_TIMELOCK_SECONDS": 172800
  },
  "deployedAt": "2026-04-22T..."
}
```

このファイルは git に含める（アドレスは公開情報）。

---

## 8. Mainnet デプロイ（Phase 1 以降）

```dotenv
JPYC_ADDRESS=0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB
BOUNTY_ADMIN_ADDRESS=0x<専用 admin EOA>
```

```bash
npx hardhat run scripts/deployBountyEscrow.js --network polygon
```

> mainnet デプロイ前にコントラクト監査を完了すること（Phase 0+ 完了条件）。

---

## コントラクト設計の重要事項

| 項目 | 設計値 | 理由 |
|------|--------|------|
| `PROTOCOL_FEE_BPS` | 0 (定数) | Phase 0+ はフィーなし。変更はコントラクト再デプロイのみ |
| `CLAIM_TIMEOUT` | 90日 | 長期プロジェクト対応 + client の資金不当凍結防止 |
| `PAUSE_TIMELOCK` | 48時間 | 緊急停止の即時実行を防ぎ、worker に猶予を与える |
| `admin` | immutable | デプロイ後変更不可。admin 移転はコントラクト再デプロイ |
| adminWithdraw | **存在しない** | 運営が資金を抜く手段は一切ない |
| `claimExpired` | pauseに依存しない | 緊急停止中でも worker は 90日後に資金回収可能 |
