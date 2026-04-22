# JPYC Commerce MCP — ディスクレイマー文面集

README 掲載用の短縮版・完全版ディスクレイマーをまとめたリファレンス。
P0-11 (README 刷新) で使用すること。

---

## A. README トップ掲載用（短縮版）

### 英語版（推奨・PRIMARY）

```
> **Legal Notice:** This software is experimental and provided as-is under the
> Apache 2.0 License. The applicability of Japan's Payment Services Act
> (資金決済法) and other financial regulations to operating this MCP server has
> not been formally reviewed by legal counsel. Do not deploy in production
> without independent legal due diligence. **Patent pending (特許出願済).**
```

### 日本語版

```
> **法的注意:** 本ソフトウェアは実験的なものであり、Apache 2.0 ライセンスのもと現状有姿で提供されます。
> 本MCPサーバーの運営に対する資金決済法その他金融規制の適用については、法律専門家による正式な確認が完了していません。
> 本番環境へのデプロイ前に、独自に法務デューデリジェンスを実施してください。**特許出願済。**
```

---

## B. Legal セクション用（完全版）

### 英語版（推奨・PRIMARY）

```markdown
## Legal Disclaimer

This software ("JPYC Commerce MCP") is provided for experimental, research,
and educational purposes only, under the terms of the Apache License 2.0.

### Regulatory Status

The applicability of the following Japanese laws and regulations to the
operation of this MCP server has **not been formally reviewed** by qualified
legal counsel:

- **Payment Services Act (資金決済法)**: Including provisions on prepaid payment
  instruments (前払式支払手段), fund transfer services (資金移動業), and
  electronic payment instruments (電子決済手段, as amended in 2023).
- **Financial Instruments and Exchange Act (金融商品取引法)**: Including
  securities classification of tokens or SBTs issued through this system.
- **Act on Prevention of Transfer of Criminal Proceeds (犯罪収益移転防止法)**:
  Including AML/KYC obligations that may apply to registry operators.

### Non-Custodial Design

This MCP server does **not** hold private keys, broadcast transactions, or
manage funds on behalf of users. All transaction signing and submission to the
Polygon network is performed exclusively by the caller using their own wallet.
The server returns calldata only. However, operators should independently
verify whether this architecture satisfies applicable regulatory requirements
in their jurisdiction.

### Registry and Fee Collection

Future versions may introduce protocol fee collection via smart contract.
Operators who collect fees from payment flows should obtain independent legal
advice on whether such activity constitutes fund transfer business (資金移動業)
or other regulated activity under Japanese law.

### SBT Issuance

Soulbound Tokens (SBTs) issued through this system are non-transferable and
carry no financial return expectation. However, any future design changes that
add governance rights, revenue sharing, or transferability must be re-evaluated
for securities law compliance.

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. THE AUTHORS
AND CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY REGULATORY PENALTIES, FINES, OR
OTHER CONSEQUENCES ARISING FROM THE USE OR OPERATION OF THIS SOFTWARE.

### Patent

Core design concepts of this system are patent pending (特許出願済).

### Recommendation

Before deploying this software in any production or commercial capacity,
consult with a qualified attorney specializing in Japanese fintech regulations.
```

### 日本語版

```markdown
## 法的免責事項

本ソフトウェア（「JPYC Commerce MCP」）は、Apache License 2.0 の条件のもと、
実験的・研究・教育目的のみに提供されます。

### 規制上のステータス

本MCPサーバーの運営に対する以下の日本法令の適用については、資格を有する
法律専門家による**正式なレビューが完了していません**：

- **資金決済法**：前払式支払手段、資金移動業、および2023年改正による
  電子決済手段に関する規定を含む
- **金融商品取引法**：本システムを通じて発行されるトークンまたはSBTの
  有価証券該当性を含む
- **犯罪収益移転防止法**：レジストリ運営者に適用される可能性のある
  AML/KYC義務を含む

### 非カストディアル設計

本MCPサーバーは、秘密鍵の保有・トランザクションのブロードキャスト・
ユーザーに代わる資金管理を**一切行いません**。Polygonネットワークへの
トランザクション署名・送信は、呼び出し元が自身のウォレットで行います。
サーバーはcalldataを返却するのみです。ただし、この設計が適用法令の
要件を満たすかどうかは、運営者が独自に確認してください。

### レジストリと手数料徴収

将来バージョンではスマートコントラクト経由のプロトコル手数料徴収が
導入される可能性があります。決済フローから手数料を徴収する運営者は、
当該行為が資金移動業その他の規制対象行為に該当するかについて、
独自に法律専門家のアドバイスを取得してください。

### SBT発行

本システムを通じて発行されるSoulbound Token（SBT）は譲渡不可であり、
金銭的リターンの期待はありません。ただし、将来のガバナンス権・収益分配・
譲渡可能性の追加を含む設計変更を行う場合は、金融商品取引法上の適合性を
再評価する必要があります。

### 無保証

本ソフトウェアは「現状有姿」で提供され、いかなる保証もありません。
作者および貢献者は、本ソフトウェアの使用・運営に起因する規制上のペナルティ、
罰金、その他の結果について一切責任を負いません。

### 特許

本システムのコア設計概念は**特許出願済**です。

### 推奨事項

本ソフトウェアを本番環境または商業目的で利用する前に、日本のフィンテック
規制を専門とする資格を有する弁護士に相談してください。
```

---

## C. README バッジ用（1行）

```markdown
[![Legal: Not Formally Reviewed](https://img.shields.io/badge/legal-not%20formally%20reviewed-yellow)](docs/legal-notes.md)
```

---

## 使用ガイドライン（README 担当者向け）

| 掲載箇所 | 使用する文面 |
|---|---|
| README.md 冒頭（Badgesの下） | A の短縮版（英語版） |
| README.md `## Legal` セクション | B の完全版（英語版） |
| 日本語 README がある場合 | A・B それぞれの日本語版 |
| GitHub Topics / About | バッジ（C）は任意 |

---

## D. BountyEscrow 固有ディスクレイマー（Phase 0+）

BountyEscrow コントラクトを使用する箇所（README、ドキュメントサイト、Discord）に追記すること。

### 英語版

```
> **BountyEscrow Notice (Phase 0+):**
> The BountyEscrow contract deployed in Phase 0+ has a **protocol fee of 0%**
> (`PROTOCOL_FEE_BPS = 0`, hardcoded as `constant`, no setter function,
> non-changeable without full redeployment). No fee recipient is configured.
>
> **Dispute arbitration is not available in Phase 0+.** Conflict resolution
> is limited to time-based expiry only:
> - Unassigned or assigned bounties that reach `expiresAt` (max 90 days from
>   creation) can be reclaimed by the poster via `claimExpired()`.
> - Submitted deliverables auto-release to the worker after 90 days if the
>   poster does not call `confirmDelivery()` — also via `claimExpired()`.
> Only OPEN-status bounties can be cancelled by the poster (full refund).
> Phase 1+ will introduce `disputeBounty()` with human arbitration.
> Size bounty rewards to reflect this risk.
>
> *Phase 1+ plan: BountyEscrow v2.2 will introduce a 0.1% protocol fee
> sent to a DAO Gnosis Safe 2-of-3 multisig (not to maintainers directly).
> See docs/phase1-roadmap.md for details.*
```

### 日本語版

```
> **BountyEscrow に関する注意（Phase 0+）:**
> Phase 0+ でデプロイされる BountyEscrow コントラクトの**プロトコル手数料は 0%**です
> （`PROTOCOL_FEE_BPS = 0`、`constant` でハードコードされており、setter 関数なし、
> 再デプロイなしに変更不可）。手数料受取先の設定はありません。
>
> **Phase 0+ では dispute（紛争）仲裁機能はありません。** 紛争解決は時限失効のみです:
> - 未着手・進行中のバウンティは作成時の `expiresAt`（最大 90 日）を過ぎると
>   `claimExpired()` で依頼主が報酬を回収できます。
> - 受注者が `submitDeliverable()` 済みで依頼主が 90 日以内に `confirmDelivery()`
>   を呼ばない場合、`claimExpired()` で受注者に自動解放されます。
> キャンセルは OPEN 状態のバウンティのみ依頼主が実行できます（全額返金）。
> Phase 1+ で `disputeBounty()` と人間仲裁が追加される予定です。
> このリスクを踏まえてバウンティ報酬額を設定してください。
>
> *Phase 1+ 予定: BountyEscrow v2.2 で 0.1% のプロトコル手数料を導入し、
> DAO Gnosis Safe 2-of-3 マルチシグに自動送金（メンテナーへの直接送金なし）。
> 詳細は docs/phase1-roadmap.md 参照。*
```

*最終更新: 2026-04-22（C案: Phase 0+ = 0%、Phase 1+ = 0.1% DAO Safe 予定に変更）| 作成: tokenomics-advisor*
*このドキュメントは法的助言ではありません。*

---

## E. 運営の非インフラ性ディスクレイマー（全チャネル共通）

README、ドキュメントサイト、Discord の FAQ に掲載すること。

### 英語版

```
> **Operator Notice — Pure Software Provider:**
> The maintainers of JPYC Commerce MCP operate **no infrastructure** on behalf
> of users. This includes: no Relayer service, no shared database, no API proxy,
> and no Polygon node. Each user runs the MCP server locally via stdio and
> connects to their own Neon DB, Anthropic API key, and RPC endpoint.
>
> The maintainers hold **no private keys, no user funds, and no relay
> infrastructure**. No protocol fees are collected in Phase 0+
> (`PROTOCOL_FEE_BPS = 0`, hardcoded constant).
>
> *Phase 1+ plan: If fees are introduced via a new contract deployment,
> they will flow to a DAO Gnosis Safe 2-of-3 multisig — not to the maintainers.
> The maintainer will be one of three Safe signers and cannot withdraw funds
> unilaterally.*
>
> This architecture is designed so that the maintainers qualify as a **pure
> software provider** under Japanese law, with no involvement in fund transfer,
> prepaid payment instruments, or electronic payment instrument services.
> Independent legal review is still recommended before production deployment.
```

### 日本語版

```
> **運営に関する注意 — ピュアソフトウェアプロバイダー:**
> JPYC Commerce MCP のメンテナーは、ユーザーに代わって**いかなるインフラも運用しません**。
> Relayer サービス、共有データベース、API プロキシ、Polygon ノードのいずれも含みません。
> 各ユーザーは MCP サーバーを自身のローカル環境で stdio 経由で起動し、
> 自身の Neon DB・Anthropic API key・RPC エンドポイントに接続します。
>
> メンテナーは**秘密鍵・ユーザー資金・Relayer インフラを一切保有しません**。
> Phase 0+ ではプロトコル手数料は徴収しません（`PROTOCOL_FEE_BPS = 0`、変更不可 constant）。
>
> *Phase 1+ 予定: 新コントラクトデプロイにより手数料が導入される場合も、
> DAO Gnosis Safe 2-of-3 マルチシグに送金され、メンテナーの個人アドレスには入りません。
> メンテナーは Safe の署名者 3 名のうちの 1 名であり、単独での引き出しは不可能です。*
>
> この設計により、メンテナーは日本法上の「ピュアソフトウェアプロバイダー」として、
> 資金移動業・前払式支払手段・電子決済手段取扱業のいずれにも該当しない主張が堅固になります。
> ただし、本番環境へのデプロイ前に独立した法務レビューを実施することを推奨します。
```
