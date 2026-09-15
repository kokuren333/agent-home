# Tailscale接続の現状

## 現在の実装

Gatewayは `0.0.0.0:8787` で待ち受けます。これは全ネットワークインターフェースから接続を受けるための待受指定で、ブラウザに入力するURLではありません。

このリポジトリにはTailscaleの設定やHTTPS reverse proxyはまだ含めていません。したがって、現状は次のような構成です。

```text
スマホ
  → Tailscaleネットワーク
  → PCのTailscale IP:8787
  → agent-home Gateway
```

PC自身では `http://localhost:8787/`、スマホでは `http://<PCのTailscale IPv4>:8787/` を使えます。HTTPS reverse proxyを設定した後は、スマホからはそのHTTPS URLを使います。

## 推奨する次の構成

Tailscale内だけで使う個人用アプリなので、最初はTailnet ACLでアクセス元を限定し、HTTPS reverse proxyをGatewayの前に置きます。Gateway自体はTLS証明書やユーザー認証を担当しません。

```text
スマホ
  → https://agent-home.<tailnet-domain>
  → Tailscale HTTPS reverse proxy
  → http://127.0.0.1:8787
  → Gateway / PWA / SQLite
```

PWAは同一オリジンのmanifest・service workerを使うため、スマホでインストールする場合はHTTPS URLを使うのが適切です。HTTPのlocalhostは開発確認用です。
