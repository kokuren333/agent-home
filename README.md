# agent-home

低スペックPCで常時稼働させる、スマートフォン向け個人用Agentアプリランチャーです。

## 起動

Node.js 22.5+ が必要です（標準SQLiteを使用します）。

```powershell
npm start
```

ブラウザで `http://localhost:8787/` を開きます。Tailscale環境では、このポートをHTTPS reverse proxyの背後に置いてください。初期状態では外部APIを使わないmock backendが動作します。

Codex CLIを使う場合は、環境変数を設定して起動します。

```powershell
$env:AGENT_BACKEND = "codex"
npm start
```

WindowsではGatewayがCodex CLIのインストール先を自動検出します。独自の場所にあるCLIを使う場合だけ、実行ファイルを明示します。

```powershell
$env:AGENT_BACKEND = "codex"
$env:CODEX_BIN = (Get-Command codex.exe).Source
npm start
```

backendを切り替えるときは、既に動いているGatewayを停止してから再起動してください。8787番ポートを古いGatewayが使っている場合は、先にそのプロセスを終了します。

モデルとreasoning effortはLauncher上部の「モデル設定」から変更できます。初期値は `gpt-5.6-luna` / `low` です。モデル候補は固定値ではなく、Codex CLIの `codex debug models` から取得します。ここで保存した値はCharacter Chatを含む全アプリのAgent実行に共通で適用されます。「CLIの既定設定を使う」を選べば、Codex側の設定をそのまま利用します。

## 検証

```powershell
npm test
```

テストはmanifestからの自動発見、Launcher一覧、demo-appの共通run/event、Character ChatのSQLite保存とstreamingを確認します。

## 構成

- `launcher/` — responsive PWA Launcher
- `gateway/` — 単一Node Gateway、run/event/SSE、SQLite
- `packages/app-protocol/` — 共通型とエラー形
- `packages/app-sdk/` — app author向け最小helper
- `apps/character-chat/` — Protocol v0.1の最初の実装例
- `apps/demo-app/` — Character Chat非依存の第二アプリ例
- `apps/challenge-tree/` — ChallengeTreeをGateway直結へ移植した学習ツリーアプリ
- `docs/architecture.md`, `docs/app-protocol.md` — 設計と仕様
- `docs/app-adapter-guide.md`, `apps/README.md` — 既存アプリ移植と追加の標準手順
- `docs/character-chat-memory.md` — Character Chatのキャラ設定・Story記憶・削除方針

新しいアプリは `apps/<id>/manifest.json` と `runtime.js`、UI entryを追加してGatewayを再起動するだけでLauncherに表示されます。ChallengeTreeもこの方式で登録されています。

ChallengeTreeは元リポジトリのReact/Viteソース、Zodスキーマ、学習コア、画面・多言語リソースを `apps/challenge-tree/src/` に保持しています。元のConnector通信は `src/gateway.ts`、IndexedDB永続化は `src/db.ts` に置き換え、学習データはGateway配下のアプリ専用SQLite領域へ保存します。変更後は `npm run build:challenge-tree`（または `npm run build`）で `dist/` を更新してください。

## キャラクターアイコン生成

Character Chatの作成・編集画面にある「設定から生成」は、GatewayからCodex CLIを呼び出し、imagegenスキルにキャラクター設定を渡してPNGを生成します。Codex CLIの認証済み環境で利用してください。生成を使わず、絵文字のまま保存することもできます。
