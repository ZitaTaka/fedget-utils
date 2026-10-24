# Fedget Utils

ブラウザだけで動くビジネス向けの変換ユーティリティ集です。
HTML + JavaScript + CSS + WebStorage のみで構成し、ビルドもサーバ側処理も不要です。

## 機能

| 区分 | 機能 | ファイル | 概要 |
|---|---|---|---|
| — | メインメニュー | `index.html` | `config/menu.yaml` から機能一覧を生成 |
| セキュリティ | パスワード生成 | `tools/password.html` | 文字種・長さ・除外文字・必須文字種・連続禁止、強度表示、TXT/CSV 出力、強度チェック |
| セキュリティ | ハッシュ計算 | `tools/hash.html` | テキスト/ファイルの MD5・SHA-1/256/384/512・CRC32、HMAC、照合、checksum 形式/CSV 出力 |
| セキュリティ | 暗号化キー生成 | `tools/keygen.html` | ランダムキー、AES/HMAC 共通鍵、RSA・ECDSA・ECDH・Ed25519・X25519 鍵ペア (PEM/JWK/JWKS/OpenSSH、ZIP 一括保存) |
| 変換 | 画像貼付け→ファイル | `tools/image-paste.html` | 貼付け/ドロップした画像を PNG・JPEG・WebP・BMP・ICO に変換、リサイズ、ZIP 一括保存 |
| 変換 | Web Snapshot | `tools/web-snapshot.html` | URL → スクリーンショット (表示範囲 / ページ全体、ビューポート指定)、履歴 |
| 変換 | Blog Snapshot | `tools/blog-snapshot.html` | 複数 URL → Jina Reader でビューポート付き Markdown 取得 → Markdown / HTML / PDF(印刷) / ZIP / JSON |

Web Snapshot と Blog Snapshot は [Jina Reader](https://jina.ai/reader) (`https://r.jina.ai/`) を
ブラウザから直接呼び出します。それ以外の機能はデータを端末外へ送信しません。
LLM は使っておらず、すべてロジックのみで動作します。

## 起動方法

静的ファイルなので任意の HTTP サーバで配信するだけで動きます。

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```

`index.html` をダブルクリックして `file://` で開いても動作しますが、ブラウザの制約で
`config/menu.yaml` を読み込めないため、組込みメニュー (またはサイドバー下部の「YAML読込」で
選んだファイル) が使われます。

## 画面構成

- **トップバー (通知エリア)**: 機能名、処理中は最新ステップと経過時間・進捗バーを表示。🔔 で通知履歴
- **ウィンドウ名**: 機能名 (処理中は先頭に ⏳)
- **サイドバー**: 機能メニュー。☰ で折りたたみ (アイコンのみ表示)、グループ単位の開閉、検索。
  状態は localStorage に保存。スマートフォン幅ではオーバーレイ表示

## メニュー定義 (`config/menu.yaml`)

サイドバーとメインメニューはこのファイルから生成されます。書いた順に並び、`children` で何階層でも入れ子にできます。

```yaml
title: Fedget Utils
items:
  - label: セキュリティ          # グループ (href なし)
    icon: 🔐
    collapsed: false            # true なら初期状態で閉じる
    children:
      - label: パスワード生成
        icon: 🔑
        href: tools/password.html   # ルートからの相対パス
        description: メインメニューのカードに出る説明
      - label: 社内ポータル
        href: https://example.com
        external: true          # 新しいタブで開く
      - label: 準備中の機能
        href: tools/wip.html
        hidden: true            # 非表示
```

YAML は外部ライブラリを使わず `assets/js/yaml.js` の軽量パーサで読みます
(マップ・リスト・クォート文字列・数値/真偽値・`[a, b]`・`|`/`>` ブロック・コメントに対応)。

## ディレクトリ構成

```
index.html                 メインメニュー
config/menu.yaml           メニュー定義
tools/<機能>.html / .js     各機能 (1 機能 = 1 HTML)
assets/css/app.css         共通スタイル (ライト/ダーク対応)
assets/js/yaml.js          YAML パーサ
assets/js/core.js          共通ユーティリティ (WebStorage, ダウンロード, コピー, 書式化, 乱数)
assets/js/shell.js         レイアウト (トップバー/サイドバー) とタスク通知 API
assets/js/lib/digest.js    MD5 / CRC32 / SHA / HMAC
assets/js/lib/zip.js       ZIP 作成 (Deflate 対応)
assets/js/lib/image.js     画像変換 (PNG/JPEG/WebP/BMP/ICO)
assets/js/lib/markdown.js  Markdown → HTML (生 HTML はエスケープ)
assets/js/lib/jina.js      Jina Reader クライアントと API キー設定 UI
```

`file://` でも動くよう ES Modules は使わず、すべて `window.Fedget*` のグローバルにまとめています。

## 機能の追加方法

1. `tools/new-tool.html` を作る (既存ページをコピー)。`<title>` が機能名になり、`<body data-root="..">` でルートを指定
2. 共通スクリプトを読み込む
   ```html
   <script src="../assets/js/yaml.js"></script>
   <script src="../assets/js/core.js"></script>
   <script src="../assets/js/shell.js"></script>
   <script src="new-tool.js"></script>
   ```
3. 処理の状態はトップバーに通知する
   ```js
   await Fedget.task.run('変換処理', async (task) => {
     task.step('ファイルを読込中', 0.2);   // 最新ステップ + 進捗 (0〜1, 省略可)
     task.step('変換中', 0.6);
     return '3件を変換しました';           // 完了メッセージ (経過時間は自動付与)
   });
   Fedget.notify('コピーしました', 'success'); // 一時通知: info / success / warn / error
   ```
4. 入力値の保存は `data-persist="name"` 属性 + `Fedget.persistForm(rootElement, 'new-tool')`
5. `config/menu.yaml` に項目を追加

## WebStorage の利用

| キー (接頭辞 `fedget.`) | 保存先 | 内容 |
|---|---|---|
| `ui.sidebarCollapsed`, `ui.menuOpen` | localStorage | サイドバーとグループの開閉状態 |
| `menu.cache` | localStorage | 最後に読み込んだ menu.yaml |
| `form.<機能>` | localStorage | 各機能の設定値 (パスワードや鍵などの生成結果は保存しない) |
| `jina.apiKey` | local / session / 保存しない | Jina API キー (画面で保存先を選択) |
| `webSnapshot.history`, `blogSnapshot.results` | localStorage | 履歴・取得結果 |

## 補足

- PDF は印刷ダイアログ経由で作成します (送信先「PDF に保存」)。日本語フォントも OS のものがそのまま使われます
- Jina のスクリーンショット URL は一定期間で失効します。必要な画像は保存してください
- WebCrypto は `https://`・`localhost`・`file://` で利用できます (それ以外の `http://` では鍵生成/SHA が使えません)
