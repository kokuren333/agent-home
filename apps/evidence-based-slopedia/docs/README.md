# EBS文書の案内

## 現行実装を使うとき

まず次を参照してください。

- [EBSアプリREADME](../README.md): 現行ランチャー統合版の起動、生成、保存
- [agent-home README](../../../README.md): 全体の起動、スマホ接続、アプリ追加
- [アプリプロトコル](../../../docs/app-protocol.md): アプリの共通規格
- [アダプターガイド](../../../docs/app-adapter-guide.md): 新しいアプリを追加する方法

## 既存文書の扱い

`ebs-phase1-report.md` から `ebs-phase5-report.md`、`ebs-migration-audit*.md`、`ARCHITECTURE-AUDIT.md` は、元リポジトリの移植・監査時点の記録です。現在の画面や実行経路の仕様書ではありません。Topics、Forecast、WebP、GitHub Pages、Discord Botに関する記述は、旧EBS単体運用の履歴としてのみ扱います。

`ebs-windows-runtime.md` も旧EBS単体ランタイムの記録です。現在のランチャー統合版は、ルートのGatewayと共通キューを使用します。

過去の調査内容を確認する必要がない場合、これらのレポートではなく上記の現行文書を参照してください。
