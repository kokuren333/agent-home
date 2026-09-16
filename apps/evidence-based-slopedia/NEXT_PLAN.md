# NEXT_PLAN — 旧EBS単体運用の設計メモ

> これは元リポジトリの単体運用を前提にした過去の設計メモです。現在のagent-home統合版の実装計画・仕様ではありません。現行仕様は [EBS README](README.md) と [EBS文書の案内](docs/README.md) を参照してください。

## 前提

現行実装は、Vault、Bot runtime、worker worktree、Pages repository、生成済みdistが複数の状態機械として結び付いている。障害時に失敗処理そのものが再試行を生み、キュー停止・古いworktree再利用・公開URL不整合が連鎖し得る。記事資産を失わず、機能追加より状態と境界の単純化を優先する。

## 安全な範囲での敵対的コードレビュー

### 最優先

- ジョブ状態がJSONファイルに集約され、多重Botや同時書き込みに弱い。
- `publish_retry_pending`、`running`、`failed_review_required` の意味が復旧処理と絡み、古いworktreeを再利用する無限再試行が起き得る。
- `ENOENT`、壊れた公開URL、検証失敗、外部障害が同じ再試行経路に流れる。
- source、runtime、worktree、Pagesの正規性が実行時設定に依存する。

### 高優先

- Markdown画像参照、Vaultパス、公開URL、WebP変換後パスが統一されておらず、相対パスの深さでHTMLが壊れる。
- 生成、検証、build、deploy、通知がworker一処理に密結合している。
- 日付、frontmatter、canonical metadata、ファイル名の責務が重複し、並び順やURLの不整合を検出しにくい。
- 修復が手動スクリプトやruntime直接編集に依存し、再現性が低い。

### 中優先

- 状態遷移、リトライ上限、パス変換、distリンク完全性を一体で検証するテストが不足している。
- 1件の不良記事が自律生成・News・Forecast全体を圧迫する。
- README、設計監査、実コードの文字コードや説明に不整合がある。

秘密情報、攻撃可能なエンドポイント、悪用手順は記載しない。

## 作り直し後の最小構成

```text
Discord/API -> Queue DB -> Worker -> Artifact store -> Gate
                                      -> Immutable build -> Deploy
```

1. SQLite等を唯一のジョブ状態ストアにする。状態は `queued -> running -> generated -> validated -> deployed` と、`failed`、`review_required`、`cancelled` に限定する。取得はversion付きcompare-and-swapにする。
2. 自動リトライは原則無効にする。transientと明示分類された失敗だけ、最大回数とバックオフ付きで再実行する。worktreeや入力成果物がなければ即レビュー待ちにする。
3. 生成、検証、build、deployを分離する。デプロイ失敗を記事生成失敗へ戻さない。
4. 内部パスはVault相対POSIXパス、公開参照はサイトルート相対URLに固定する。slugは作成時にASCII正規形式へ確定する。
5. buildは一時ディレクトリで全リンク・画像・件数を検証してからimmutableなbuild IDへ昇格する。Deployは検証済みbuildだけを同期する。
6. 手動記事、News、Forecast、自律生成を別キューに分け、各キューに上限と独立停止スイッチを持たせる。

## 移行順序

1. 記事、画像、metadataを読み取り専用で棚卸しし、バックアップと件数ハッシュを作る。
2. slug、sourcePath、assetPathをdry-run移行し、差分を確認する。
3. 未完了ジョブだけを新DBへ移し、古いretryは自動復活させない。
4. 各段階を独立して再実行できる生成・検証・build・deployを実装する。
5. shadow buildで新旧distのURL、件数、画像を比較する。
6. 手動記事、News、失敗ケース各1件で受け入れテストを行う。
7. 監視・停止・手動Retryを確認してから自律生成を有効化する。

## 完了条件

- Botを複数起動しても二重実行されない。
- 再起動だけで失敗ジョブが復活しない。
- Retry回数に上限があり、超過後はレビュー待ちになる。
- 生成、検証、デプロイの失敗を別々に表示・再実行できる。
- 全HTMLのリンクと画像URLをCIで検証できる。
- 本文、画像、metadata、ジョブ履歴を個別に復元できる。

## 当面の運用

再設計が完了するまで自律生成と大量投入を停止し、手動1件ずつ運用する。`failed_review_required` は自動Retryしない。runtimeを変更するときはBot停止、バックアップ、変更理由、変更後件数を記録する。
