# TrustSBT メタデータ仕様

ERC-5192 準拠 TrustSBT の tokenURI が返す JSON メタデータの仕様書。

## スキーマ

```json
{
  "name": "JPYC Commerce Trust SBT #<tokenId>",
  "description": "Soul Bound Token representing verified agent trust in the JPYC Commerce MCP ecosystem.",
  "image": "ipfs://<CID>/trust-sbt-<rank_lower>.png",
  "external_url": "https://jpyc-commerce.example/sbt/<tokenId>",
  "attributes": [
    { "trait_type": "trust_score",          "value": 72,             "display_type": "number" },
    { "trait_type": "completion_count",     "value": 42,             "display_type": "number" },
    { "trait_type": "rank",                 "value": "Gold" },
    { "trait_type": "auto_approve_limit",   "value": 2000,           "display_type": "number" },
    { "trait_type": "merkle_root",          "value": "0xabc123..." },
    { "trait_type": "merkle_epoch",         "value": 7,              "display_type": "number" },
    { "trait_type": "issued_at",            "value": 1745249780,     "display_type": "date" },
    { "trait_type": "last_active_at",       "value": 1745249780,     "display_type": "date" }
  ]
}
```

## フィールド定義

| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | `"JPYC Commerce Trust SBT #<tokenId>"` |
| `description` | string | 固定文言（英語） |
| `image` | string | IPFS URI。ランク別画像（Phase 1 以降）。Phase 0 は省略 |
| `external_url` | string | 将来の SBT エクスプローラー URL（Phase 0 は省略可） |

## attributes 定義

| trait_type | 型 | 説明 |
|---|---|---|
| `trust_score` | number | **0〜100 の整数スコア**（calculateTrustScore の出力を 100倍して丸め） |
| `completion_count` | number | タスク完遂数（整数） |
| `rank` | string | スコア帯によるランク（下記参照） |
| `auto_approve_limit` | number | このランクで自動承認される JPYC 上限。Platinum は null（制限なし） |
| `merkle_root` | string | 直近の Merkle Root（bytes32 hex、0x プレフィクス付き） |
| `merkle_epoch` | number | Merkle Root のエポック番号（整数） |
| `issued_at` | number | 最初の mint 時刻（UNIX timestamp） |
| `last_active_at` | number | 最後のスコア更新時刻（UNIX timestamp） |

## ランク定義（tokenomics-advisor 設計準拠）

trust_score は calculateTrustScore の出力（0.0〜1.0）を 100倍した整数値で比較する。

| ランク | trust_score 帯（整数） | 自動承認上限 | Rezona UI 表示 |
|---|---|---|---|
| Bronze | 0〜29 | 100 JPYC/回 | 銅バッジ |
| Silver | 30〜59 | 500 JPYC/回 | 銀バッジ |
| Gold | 60〜99 | 2,000 JPYC/回 | 金バッジ + スポットライト演出 |
| Platinum | 100 | 上限なし（人間承認のみ） | 白金バッジ + 専用入場SE |

### ランク計算ロジック（lib/sbtClient.js の `computeRank` と共通）

```js
function computeRank(trustScore) {
  const s = Math.round(trustScore * 100); // 0.72 → 72
  if (s >= 100) return { rank: 'Platinum', autoApproveLimit: null };
  if (s >= 60)  return { rank: 'Gold',     autoApproveLimit: 2000 };
  if (s >= 30)  return { rank: 'Silver',   autoApproveLimit: 500 };
  return              { rank: 'Bronze',    autoApproveLimit: 100 };
}
```

## Phase 別のホスティング方針

### Phase 0（現在）
- `metadataURI` は `data:application/json,...` の data URI でインライン埋め込み
- `image` フィールドは省略（ウォレット側のデフォルト表示に任せる）
- mint 時にのみメタデータを設定。`updateTrustScore` では Merkle Root のみ更新し URI は変えない

### Phase 1 以降
- Pinata / web3.storage へ IPFS ピン
- `image` にランク別 PNG の IPFS URI を設定
- ランクアップ時に `setTokenURI` で URI を更新

## mint calldata の生成例

```js
import { buildMintCalldata, buildMetadataURI } from './lib/sbtClient.js';

// buildMetadataURI がランク計算を内包している
const metadataURI = buildMetadataURI(
  0.72,   // trust_score (0.0-1.0)
  42,     // completion_count
  new Date().toISOString(),  // issued_at
);

const instruction = buildMintCalldata('0xYourWallet...', metadataURI);
// instruction.data を秘密鍵で署名して送信する（MCP 側は署名しない）
```

## コントラクト関数との対応

| 操作 | コントラクト関数 | 引数 |
|---|---|---|
| 初回発行 | `mint(address to, string metadataURI)` | to=ウォレット, metadataURI=上記 JSON の data URI |
| スコア更新 | `updateTrustScore(uint256 tokenId, bytes32 merkleRoot)` | 最新の Merkle Root |
| URI 更新（オプション） | `setTokenURI(uint256 tokenId, string uri)` | 新しい IPFS URI |

## コントラクト内の trust_score 表現

TrustSBT.sol は trust_score を `uint256` で保存する際、**100倍の整数**（例: 0.72 → 72）として扱う。
オフチェーン DB の `trust_score` カラム（float, 0.0〜1.0）と区別すること。
