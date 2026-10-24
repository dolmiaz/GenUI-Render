# GenUI Render

[English](README.md)

ChatGPT の回答の画面部品(地図・選択肢・数値カード・枠組み・グラフ・出典チップ)を、ChatGPT のデータエクスポートの記法を残したノートから Obsidian の中に描きます。ブロックは閲覧モードと Live Preview、文中のチップは閲覧モードで描画します。

## ノートに入っている必要があるもの

ChatGPT は画面部品を回答本文の中の記法として持っています。GenUI Render はその2つの形を描きます。

**1. `chatgpt-ui` コードブロック** — genui 部品の JSON:

````markdown
```chatgpt-ui
{"map_widget": {"points": [{"name": "フォルクスガルテン", "address": "Volksgarten, Vienna, Austria"}], "answer": "国会の近くの静かな公園です。"}}
```
````

| 部品 | 描き方 |
| --- | --- |
| `map_widget` | 番号付きの場所カードと Google / Apple マップへのリンク。**地図を表示** で OpenStreetMap の地図に描く(ドラッグ、+ / −)。 |
| `ask_user_input` | 選択肢のチップ(1つ/複数)と自由入力欄。**回答を保存** で `selected` と `free_text` をブロックに書き戻す。 |
| `math_block_*` | display 数式。 |
| `suggest_automation` | 小さなカード。 |
| `sources` | `{"sources": [{"title", "url", "site"}]}` — そのターンの検索結果。出典チップから開く。 |
| その他 | 部品名と JSON を折りたたみで表示。HTML アプリ(`app_block`)は実行しない。 |

**2. 新しい回答の JSX 風の記法**(2026年10月頃から):

- `chatgpt-jsx` コードブロックの中: 枠組み `<box>` `<row>` `<col>` `<grid>`/`<grid-item>` `<list>`/`<list-item>` `<table>`/`<table-row>`/`<table-cell>`、文字 `<title>` `<text>` `<caption>` `<badge>`、`<divider/>` `<icon/>`、`<WritingBlock>`(コピーボタン付きの文章)、`<CodeBlock>`(コードブロック。Mermaid も描く)、`<Chart/>`(ChatGPT と同じ横棒、折れ線)、`<AsyncImageGroup/>`、ふつうの SVG 図。ChatGPT がテンプレートのコード(`{#each}` や式)で描く図は実行せず、代わりの表示を出す。入力部品(`<radio>` `<checkbox>` `<slider>` `<button>`)は操作できない形で表示。
- 本文中のインラインコード: `` `<Cite …/>` `` → 出典チップ(押すとそのターンの `sources` 一覧が開く)、`` `<FileCite name="…" …/>` `` → ファイルのチップ、`` `<MemoryCite/>` `` → メモリのチップ、`` `<icon …/>` `` → アイコン、`` `<Entity value="…"/>` `` → 名前をそのまま文字で、`` `<AsyncImage query="…"/>` `` → 画像(後述)、`` `<badge>…</badge>` `` / `` `<text>…</text>` ``。

ChatGPT のエクスポートには、各 `<Cite>` がどの検索結果を指すかが残っていません。そのためチップからは特定のページではなく、ターンの出典一覧が開きます。

### ChatGPT のエクスポートからノートを作る

`tools/chatgpt-export-to-md.py` は ChatGPT のデータエクスポート(設定 → データコントロール → エクスポート)を、会話ごとに1つのノートにこの形で書き出します。Python 3 だけで動き、どこにも送信しません:

```bash
python3 tools/chatgpt-export-to-md.py ~/Downloads/chatgpt-export.zip ~/MyVault/ChatGPT
```

自前の取り込みツールがある場合は、`tools/chatgpt_markup.py` の変換(`normalize`・`sources`・`name_filecites`)を使えます。2回かけても結果は変わりません。

## 設定

部品の種類ごと(出典チップ・出典一覧・ファイルのチップ・用語・アイコン・画像・グラフ・文章作成・枠組み・地図・選択肢・数式・その他)にオン・オフできます。オフの部品は元の文字のまま表示します。

## 通信とプライバシー

頼まれない限り何も送りません。

- **地図**: **地図を表示** を押したときだけ、そのブロックの場所の名前と住所を OpenStreetMap の Nominatim へ送り(1秒に1件)、地図画像を `tile.openstreetmap.org` から読み込みます。座標はプラグインのデータにキャッシュします。
- **画像**(`<AsyncImage>`)、**初期設定はオフ**: オンにすると各画像の検索語を Openverse(`api.openverse.org`)へ、見つからなければ Wikimedia Commons へ送ります。最初の結果を画像の幅に縮小して JPEG で Vault 内のフォルダ(設定、初期値 `chatgpt-ui-images/`)に保存し、`index.json` に検索語・出典ページ・題名・作者・ライセンスを記録します。取得は1回だけです。画像にカーソルを置くとクレジット、クリックで出典ページを開きます。この方法で見つかる画像は検索語からの推定で、ChatGPT が表示した画像そのものではなく、それぞれのライセンスに従います。Vault を git で同期している場合は、このフォルダを除外するとよいでしょう。

利用状況の送信・アカウント・キーはありません。

## 注意

- **回答を保存** はコードブロックを書き換えます。取り込みツールがノートを作り直すと回答は消えます。
- 地図データ © OpenStreetMap contributors。画像の著作権は各作者に帰属します(`index.json` を参照)。

## 導入

`main.js`・`manifest.json`・`styles.css` を `<vault>/.obsidian/plugins/genui-render/` にコピーし、設定 → コミュニティプラグインで **GenUI Render** を有効にします。

## ライセンス

MIT
