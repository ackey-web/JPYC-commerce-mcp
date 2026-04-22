# Phase 0+ 公開前セキュリティ監査レポート

- **実施日**: 2026-04-22
- **実施者**: security-qa（Quality Division）
- **対象ブランチ**: `test/phase0-negotiation-escrow`（HEAD `5d6c848`、親 `e8d5991`）
- **タスク**: P0-25 (Task #31)

## 総合判定

**条件付き PASS**（下記 2 件の軽微な残留対応後、公開可）

- 10 項目中 **8 件 PASS**、**2 件 FIXED**（本監査で修正コミット予定）、**0 件 FAIL**
- `npm audit --audit-level=high` は 0 vulnerabilities
- コミット履歴に実シークレット漏洩なし（プレースホルダ・参照のみ）
- ノンカストディアル原則・ライセンス・SECURITY.md 体制は公開レベル

---

## 10 項目チェック結果

### 1. `.gitignore` — FIXED

**修正前の状態**:
```
node_modules/
.env
.env.local
```

→ `.env.*.local`、`.DS_Store`、`*.log`、`contracts/artifacts/`、`contracts/cache/`、`contracts/deployments/*.json` など複数の必須除外が不足。また作業ディレクトリに untracked `.DS_Store` が存在。

**修正後**: 本監査で `.gitignore` を拡充。
- `.env.*.local`, `.env.production`, `.env.development`
- `.DS_Store`, `*.swp`, `*.swo`
- `*.log`, `npm-debug.log*`, `.claude_code_session`
- `contracts/artifacts/`, `contracts/cache/`, `contracts/deployments/*.json`
- `coverage/`, `.nyc_output/`

**判定**: FIXED（この監査コミットで解消）

### 2. コミット履歴の秘密情報スキャン — PASS

```bash
git log --all -p | grep -iE "(private_key|secret|password|DATABASE_URL=postgres|NPG_|API_KEY|ANTHROPIC_API)"
```

98 件ヒットしたが、全てプレースホルダ（`0x...`, `xxxx`, `aaaa...`）、変数名参照、ドキュメント文字列、エラーメッセージ内の env 名言及のみ。実シークレットの漏洩はゼロ。

代表的な検出例（すべてセーフ）:
- `.env.example` のプレースホルダ: `DATABASE_URL=postgres://user:password@...neon.tech/neondb`、`ANTHROPIC_API_KEY=sk-ant-api03-xxxx...`、`MERKLE_COMMIT_PRIVATE_KEY=0xaaa...aaa`
- コード内の env 名参照: `process.env.ANTHROPIC_API_KEY`
- エラーメッセージ: `DATABASE_URL が設定されていません`
- README/docs の設定説明文

**判定**: PASS

### 3. `.env.example` プレースホルダ確認 — PASS

全変数がダミー値:
- `DATABASE_URL` → `postgres://user:password@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
- `ANTHROPIC_API_KEY` → `sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- `MERKLE_COMMIT_PRIVATE_KEY` → `0xaaaaaaaa...`（32 バイト全 a）
- `SBT_CONTRACT_ADDRESS_AMOY` → `0x0000000000000000000000000000000000000000`
- `INSECURE_TEST_BYPASS_APPROVAL` → `false`（SEC-3 対応、本番 NG 明記）

**判定**: PASS

### 4. README のノンカストディアル原則明記 — PASS

README.md 内 10 箇所以上で非カストディアル原則に言及:
- L3 tagline: "non-custodial JPYC payment instructions"
- L11: 設計原則 "Non-Custodial by Design — The MCP server never holds private keys"
- L27 アーキテクチャ図: `calldata only`
- L49 明示: `Non-custodial principle: MCP returns calldata only. No private keys stored, no transactions broadcast by the server.`
- L143/166 ツール一覧: `calldata (non-custodial)` を各送金系ツールに明記
- L277-279 ライセンス節: "This MCP server does not hold private keys, broadcast transactions, or manage funds on behalf of users."
- 例外の Merkle Root コミット用運営 EOA についても明示

**判定**: PASS

### 5. SECURITY.md の報告窓口 — PASS

- GitHub Security Advisories "Report a vulnerability" が第一推奨
- メール経路（README 参照）も併記
- 重大度別 SLA テーブル（Critical / High / Medium / Low）
- ノンカストディアル前提条件の明示
- 対応プロセスとディスクロージャ方針

**判定**: PASS

### 6. Apache 2.0 LICENSE / NOTICE 整合 — FIXED

**修正前の状態**: `NOTICE` に `@supabase/supabase-js` が `(scheduled for removal)` として残っていたが、実際には SEC-4 完了時に依存削除済み。また `ethers` / `pg` に `(to be added)` という未更新コメント。

**修正後**: 本監査で NOTICE を更新。
- `@supabase/supabase-js` を削除
- `ethers`, `pg`, `keccak256`, `merkletreejs` のステータスを確定記載
- Apache 2.0 / Copyright 2026 / Patent notice は変更なし

**判定**: FIXED（この監査コミットで解消）

### 7. 外部公開 NG ワードスキャン — PASS

禁止語: `<禁止ワード1>`、`<禁止ワード2>`（「特許出願済」「patent-pending」は OK。実語句は非公開マスタ参照）

**git log**:
- `git log --all -p | grep -E "(<禁止ワード1>|<禁止ワード2>)"` → 1 件ヒット（実語句で実行時）
- 内容: `DEVELOPMENT_PLAN.md` の「**NGワード**: `<禁止ワード1>`、`<禁止ワード2>` は絶対禁止」という**禁止事項を明示するための記述**のみ。実使用ゼロ。

**working tree**:
- `DEVELOPMENT_PLAN.md`, `docs/marketing-release-checklist.md`, `docs/marketing-drafts.md`, `docs/archive/CLAUDE_md_20260421.md` に出現
- すべて **禁止ポリシーを記述するための引用**
- 公開用 README / コード / コントラクト / マーケ訴求本文には **1 件もない**
- R2 Option A 採用後、working tree 側は全て抽象参照化（`<禁止ワード1>` / `<禁止ワード2>`）で置換済

補足リスクと推奨:
- `DEVELOPMENT_PLAN.md` と `docs/marketing-release-checklist.md` も公開リポジトリに含まれるため、NG 語検索で引っかかる可能性がある。引用記法を変え（抽象参照化 `<禁止ワード1>` 等）、検索ヒットを避けると安全度が上がる。R2 Option A で実施済。
- `docs/archive/CLAUDE_md_20260421.md` は archive としてのアクセス頻度は低いが同様の対応が望ましい。
- NOTE: これは CHECK 7 本来の趣旨（実使用の検出）では PASS。公開戦略上の任意改善項目として記録。

**判定**: PASS（任意改善項目あり）

### 8. 依存パッケージの脆弱性スキャン — PASS

```
$ npm audit --audit-level=high
found 0 vulnerabilities
```

**判定**: PASS

### 9. Hardhat artifacts / cache / deployments — PASS

- `git ls-files contracts/` → `artifacts/`, `cache/`, `deployments/*.json` の追跡ファイルなし
- `contracts/.gitignore` は存在しないが（P0-23 で整備されていた想定だが現時点ディスク上に見当たらず）、ルートの `.gitignore` を今回拡充して二重ガード

**判定**: PASS

### 10. 衛生ファイル — FIXED

- tracked: `.DS_Store` / `.claude_code_session` / `*.log` は **0 件**（PASS）
- untracked: 作業ディレクトリに `.DS_Store` が 1 件存在
  - CHECK 1 の `.gitignore` 拡充で除外対象となり、以降コミット対象外になる

**判定**: FIXED（gitignore 拡充で解消）

---

## 修正サマリー（この監査で実施）

| ファイル | 変更 | 目的 |
|---|---|---|
| `.gitignore` | 拡充（3 行 → 24 行） | `.env.*.local`, `.DS_Store`, `*.log`, contracts artifacts 等を除外 |
| `NOTICE` | `@supabase/supabase-js` 削除、残依存を確定記載 | Apache 2.0 の第三者ライセンス一覧を実態と一致 |
| `docs/phase0-release-audit.md` | 新規（本レポート） | 監査結果のエビデンス保全 |

## Phase 0+ 公開判定

**結論**: 上記 3 ファイルのコミット後、**公開可**。

### 残推奨アクション（任意・低優先）
1. CHECK 7 の NG 語句を含む 4 ファイルについて伏字化（検索ヒット回避）。マーケ部門判断。
2. `contracts/.gitignore` の新規作成（Hardhat ビルド時の artifacts が公開ブランチに混入しないよう、contracts/ サブディレクトリ側にも明示的に配置）。

### 非推奨（やってはいけない）
- この監査コミット後の `rm -rf .git && git init` のような履歴書き換え（98 件のヒットは全てセーフなため不要）
- BFG Repo-Cleaner（実シークレットがないため不要）

## 次のアクション

1. `.gitignore`, `NOTICE`, `docs/phase0-release-audit.md` を単独コミット
2. Task #31 → completed、project-leader に最終判定を共有
3. Task #20 (P0-18 E2E テスト) の結果と合わせて Phase 0+ 完了判定へ
