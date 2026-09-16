# EBS architecture audit（旧単体運用の監査記録）

> 元リポジトリの移植時点の記録です。現在のagent-home統合版では、ルートGatewayと共通キューが実行境界です。現行仕様は [EBS README](../README.md) を参照してください。

## 結論

公開経路の正規形は次のとおりとする。

```text
article job / worker
  -> source and canonical article state
  -> publish gate
  -> index rebuild
  -> atomic static build
  -> dist integrity validation
  -> Pages repository sync
  -> commit and push
```

`deploy`は`dist/`だけを入力とし、source Markdown、MOC、canonical metadata、JobStore、worktree、Codex状態を再解釈しない。現在の`DeployService`と`DirectoryDeploymentTarget`はこの境界を満たしている。Pages repository側では`.git`を保持し、差分がある場合だけcommit/pushする。

## 責務

| Component | 責務 |
| --- | --- |
| article generator | 調査・執筆・画像生成・Publish Gate用成果物の作成 |
| worker | 隔離worktreeでgeneratorを実行し、成果物を検証してsourceへ反映 |
| canonical/source store | 記事本文、metadata、revision、operationの永続化 |
| index builder | 公開記事だけから検索・カテゴリ・MOC・関連・sitemapを生成 |
| build | sourceとgenerated indexから完全な静的`dist/`をatomicに生成 |
| dist validation | 必須ファイル、公開記事数、リンク、画像形式、情報漏洩を確認 |
| deploy | 完成済み`dist/`を静的ホストへ同期し、必要時のみpush |
| doctor | 診断・修復用。通常のdeployの前提条件ではない |
| Discord bot | job投入、状態表示、管理操作。記事内容の再解釈はしない |

## チェックの配置

### publish gateとして残すもの

- workerが記事成果物を作成したこと
- queued operationがpublishedへ正しく反映されたこと
- 公開対象画像の参照が解決できること
- 公開記事がcanonical metadataとindexへ登録されること
- キャンセル済みjobの成果物を公開しないこと

### build invariantとして残すもの

- `dist/`をatomicに生成すること
- 必須HTML、index、CSS、検索JSON、sitemapが存在すること
- 公開記事数と検索indexが一致すること
- `dist/`にPNG/JPEG等の公開禁止画像がないこと
- private runtime情報を含まないこと
- dist内の内部リンクが解決できること

### deployに残すもの

- `dist/`の存在と完成物としての整合性
- Pages repositoryがGit repositoryであること
- `.git`を保持した同期
- 差分がある場合のみcommit/push
- push失敗のエラー返却

### doctorに限定するもの

- stale indexの診断・修復
- orphan metadata、tombstone、MOCの診断
- interrupted jobや失敗job residueの診断
- canonicalイベントとrevisionの詳細監査

doctorは必要な診断機能だが、毎回の公開処理で全項目を実行する必要はない。`rebuild`が作る`dist`のinvariantを満たせば、deployへ進める。

## 現在の不要な特別経路

現時点でdeploy専用のsource解析経路やGitHub Actions依存は確認されない。MOC maintenance、image maintenance、doctorは管理・診断コマンドとして残し、通常の記事jobと混同しない。画像生成は公開記事で必要な場合のみpublish gateで扱い、`dist`にはWebPだけを置く。

## 運用コマンド

通常の公開は次の2段階である。

```powershell
npm run ebs -- rebuild --json
npm run ebs -- deploy --json
```

自動deployを有効にした場合は、記事job成功後に同じ`rebuild -> deploy`をworkerが実行する。`doctor`、`moc-maintenance`、`image_maintenance`は問題調査または明示的な保守時に実行する。
