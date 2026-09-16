# Tailscaleでスマホから使う

agent-homeはPC上のGatewayを入口にして、同じTailnetに接続したスマホからアプリを使う構成です。Tailscale自体の設定ファイルや認証情報は、このリポジトリには保存しません。

## PC側

1. TailscaleにPCでログインする。
2. agent-homeを起動する。
3. PCのターミナルで次を一度実行する。

```powershell
tailscale serve --bg http://127.0.0.1:8787
```

表示された `https://...ts.net` のURLがスマホ用の入口です。設定の確認には次を使います。

```powershell
tailscale serve status
```

`serve` はTailnet内だけに公開します。Funnelやルーターのポート開放は使用しません。Gateway自身はログイン機能を持たないため、Tailnetの端末管理を信頼境界として扱います。

PC自身での確認は `http://localhost:8787/` で行えます。Gatewayは `0.0.0.0:8787` で待ち受けますが、スマホから直接HTTPポートへ接続することは推奨しません。

## スマホ側

1. Tailscaleアプリをインストールして、PCと同じTailnetにログインする。
2. PC側で表示されたHTTPS URLをスマホのブラウザで開く。
3. 必要ならブラウザの「ホーム画面に追加」でPWAとして登録する。

HTTPSを使うため、PWAのインストールやService Workerも利用できます。接続できない場合は、PCが起動中か、Tailscaleが両端末で接続済みか、`tailscale serve status` に転送設定が表示されるかを確認します。

## 注意

- `.env`、認証情報、Tailnetの固有設定、個人用URLをコミットしない。
- `http://<Tailscale IP>:8787` は切り分け用の直接接続であり、通常の利用入口にはしない。
- Gatewayを停止すると、スマホ側のアプリも利用できない。
- Codexバックエンドを使う場合は、PC側でCodexが利用可能な状態でGatewayを起動する。
