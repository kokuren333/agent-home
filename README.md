# agent-home

agent-homeは、PCで動かす個人用のAIアプリランチャーです。1つのGatewayで複数の小さなアプリを動かし、PCのブラウザだけでなく、同じTailnet上のスマートフォンからも利用できます。

## コンセプト

agent-homeは、ランチャーとアプリを分けた構成です。

- ランチャーはアプリ一覧、並び順、表示・非表示を管理する
- 各アプリは自分のUIと機能を持つ
- GatewayはAgent実行、イベント配信、保存処理を共通化する
- アプリ固有のデータや処理は、各アプリのディレクトリに置く
- アプリを追加しても、原則としてランチャーのコードは変更しない

データはPCのGatewayが管理するSQLiteに保存されます。ブラウザの`localStorage`や`IndexedDB`を基本の保存先にはしません。

## 必要なもの

- Windows PC
- Node.js 22.5以上
- ブラウザ
- Codexバックエンドを使う場合は、インストール済み・ログイン済みのCodex CLI
- スマートフォンから接続する場合は、PCとスマホのTailscale

## PCで起動する

### テスト用のmockバックエンド

```powershell
npm install
npm start
```

ブラウザで <http://localhost:8787/> を開きます。

### Codexバックエンド

```powershell
$env:AGENT_BACKEND = "codex"
npm start
```

Codex CLIを自動検出できない場合:

```powershell
$env:AGENT_BACKEND = "codex"
$env:CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
npm start
```

状態確認:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/api/health
```

レスポンスの`ok`が`true`で、`backend`がCodexとして表示されれば起動しています。認証情報やAPIキーはリポジトリ内に保存しないでください。

## 基本的な使い方

1. `http://localhost:8787/`を開く
2. ランチャーからアプリを選ぶ
3. アプリ内で入力・生成・保存を行う
4. 必要に応じてランチャーへ戻る

ランチャーのアプリ一覧では、アプリの並び替えと表示・非表示を変更できます。モデルとreasoning effortもランチャーの共通設定から変更できます。

## デフォルトで入っているアプリ

### Evidence Based Slopedia

根拠となるソースを調査して記事を作成する知識ポータルです。記事検索、記事カード、Articles・Newsのバックナンバー、記事作成キュー、今日のニュース生成、ソースURLと画像の保存に対応しています。

### Challenge Tree

学習テーマをツリー構造にして、問題を解きながら進める学習アプリです。AIによるツリー提案、説明式・短答式・正誤式の問題、回答採点、ノード追加・展開、学習データの保存・書き出しに対応しています。

### Character Chat

キャラクター設定を保存して会話できるアプリです。キャラクター・ペルソナ・ストーリー設定、会話履歴、ストリーミング応答、キャラクター画像生成に対応しています。

### Hello Agent

App Protocolのサンプルアプリです。自由入力をAgentへ送り、返答を表示します。新しいアプリを作るときの雛形として利用できます。

## スマートフォンから使う

PCとスマホを同じTailnetへ参加させ、Tailscale ServeでGatewayへ接続します。Tailscale ServeはTailnet内の端末へサービスを公開します。[公式仕様](https://tailscale.com/docs/reference/tailscale-cli/serve)

### PC側

Gatewayを起動したまま、別のPowerShellで実行します。

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

表示されたHTTPS URLを確認します。`tailscale funnel`はインターネット全体への公開機能なので使用しません。

### スマホ側

1. Tailscaleアプリをインストールする
2. PCと同じアカウントまたはTailnetへログインする
3. Tailscaleを接続状態にする
4. PCに表示されたHTTPS URLをスマホのブラウザで開く
5. 必要なら「ホーム画面に追加」でランチャーを登録する

接続できない場合は、同じTailnetにいること、PCのTailscaleが接続中であること、Gatewayが起動していること、`tailscale serve status`に設定が表示されることを確認します。

Gatewayには一般向けのログイン画面や認証機能はありません。インターネットへ直接ポート公開せず、Tailnet内で使用してください。

## 自分用のアプリを追加する

`apps/`の下にアプリディレクトリを追加し、Gatewayを再起動するとランチャーが自動検出します。アプリのインストール画面はありません。

### 静的アプリの最小構成

```text
apps/my-app/
├─ manifest.json
└─ ui/
   └─ index.html
```

Agent実行やアプリ固有の保存を使う場合は、`runtime.js`を追加します。

```text
apps/my-app/
├─ manifest.json
├─ runtime.js
└─ ui/
   └─ index.html
```

### manifest.json

```json
{
  "id": "my-app",
  "name": "My App",
  "description": "アプリの機能を短く説明します。",
  "version": "0.1.0",
  "icon": "✨",
  "entry": "/apps/my-app/ui/index.html",
  "capabilities": []
}
```

Agent実行を使う場合は`capabilities`に`run`、保存APIを使う場合は`resources`を追加します。対応する処理はアプリ側の`runtime.js`へ実装します。

### 作り始めるとき

最初は[Hello Agent](apps/demo-app)をコピーし、`manifest.json`、`ui/`、`runtime.js`を置き換える方法が簡単です。ReactやViteを使う場合はアプリ内にソースとビルド設定を置き、manifestの`entry`がビルド後のファイルを指すようにします。

詳しいAPIとイベント形式は、[App Protocol](docs/app-protocol.md)と[アプリ追加ガイド](docs/app-adapter-guide.md)を参照してください。

## データとGit

実行時データはリポジトリへ含めません。

- `data/`: GatewayのSQLite、WAL、その他の実行データ
- アプリのログ、キャッシュ、runtime state
- EBSの生成記事、生成画像、作業ログ
- `.env`と認証情報
- ビルドで再生成できるEBSの静的出力

これらは`.gitignore`で除外しています。設定例の`.env.example`だけは対象にできますが、実際のキーやトークンは記入しないでください。

公開前の確認:

```powershell
git add --dry-run .
git status --short --ignored
npm run build
npm test
npm audit --omit=dev --audit-level=high
```

## 開発用コマンド

```powershell
npm run build
npm test
npm audit --omit=dev --audit-level=high
```

## ライセンス

このリポジトリのオリジナルコードはMIT Licenseです。[LICENSE](LICENSE)。移植元の著作権表示とライセンスは[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)に記載しています。
