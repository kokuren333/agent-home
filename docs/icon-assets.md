# アプリアイコン運用ガイド

## 対象

Launcherに表示するアプリのアイコンと、アプリ内で表示するキャラクターアイコンは分けて管理します。

- アプリアイコン: `apps/<app-id>/ui/assets/app-icon.png` または同じアプリ配下の画像
- キャラクターアイコン: Character Chatが管理する `data/character-icons/*.png`

## App manifest

`manifest.json` の `icon` に、アプリ配下の同一オリジンURLを指定します。

```json
{
  "id": "research-tools",
  "icon": "/apps/research-tools/ui/assets/app-icon.png"
}
```

推奨仕様は正方形PNG、1024×1024程度、文字なし、透かしなし、中心に小さく表示しても識別できる単一シンボルです。現在のLauncherは画像URLと絵文字の両方を受け付けますが、新規アプリは画像URLを推奨します。

## imagegenで作る場合

imagegenには次の条件を含めます。

```text
Use case: stylized-concept
Asset type: square app icon for a mobile launcher
Composition/framing: centered single symbol, generous padding, recognizable at 48px
Constraints: no text, no letters, no logo, no watermark, no mockup frame
```

アプリの役割を1つの視覚的な記号へ落とし込み、既存アイコンと同じ配色・質感を再利用します。生成後はプロジェクト内の `apps/<id>/ui/assets/` に保存し、manifestの `icon` を更新してください。生成画像をCodexホーム配下だけに残して参照することは禁止します。

## 今後のアプリ追加手順

1. `apps/<id>/ui/assets/app-icon.png` を用意する。
2. `manifest.json` の `icon` をそのURLにする。
3. Gatewayを再起動する。
4. Launcherで画像表示とスマホ幅での視認性を確認する。

アプリ固有UIのアイコンは各アプリの `ui/` に置き、LauncherやGatewayのコードにアプリ名別の分岐を追加しません。

## 生成ボタンとの関係

Character Chatの「設定から生成」は、キャラクター設定から個別画像を作る機能です。アプリアイコン生成はmanifest用の静的アセットとして別途作成します。将来アプリ作成画面を追加する場合も、同じ画像仕様とCodex CLI imagegen境界を利用します。
