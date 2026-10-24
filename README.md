# GenUI Render

[日本語](README.ja.md)

Draw ChatGPT's answer UI — maps, choice questions, stat cards, layouts, charts, source chips — inside Obsidian, from notes that keep the markup of a ChatGPT data export. Blocks are drawn in Reading view and Live Preview; inline chips in Reading view.

## What the notes need to contain

ChatGPT keeps its UI as markup inside the answer text. GenUI Render draws two forms of it.

**1. `chatgpt-ui` code blocks** — the JSON of a "genui" part:

````markdown
```chatgpt-ui
{"map_widget": {"points": [{"name": "Volksgarten", "address": "Volksgarten, Vienna, Austria"}], "answer": "A quiet park near the parliament."}}
```
````

| Part | Drawn as |
| --- | --- |
| `map_widget` | Numbered place cards with Google / Apple Maps links. **Show map** draws them on an OpenStreetMap map (drag, + / −). |
| `ask_user_input` | Choice chips (one or several) and a free-text field. **Save answers** writes `selected` and `free_text` back into the block. |
| `math_block_*` | Display math. |
| `suggest_automation` | A small card. |
| `sources` | `{"sources": [{"title", "url", "site"}]}` — the search results of a turn, opened by source chips. |
| anything else | Its name and the JSON, folded. HTML apps (`app_block`) are never run. |

**2. JSX-like markup of newer answers** (from about October 2026):

- in a `chatgpt-jsx` code block: layouts `<box>` `<row>` `<col>` `<grid>`/`<grid-item>` `<list>`/`<list-item>` `<table>`/`<table-row>`/`<table-cell>`, text `<title>` `<text>` `<caption>` `<badge>`, `<divider/>` `<icon/>`, `<WritingBlock>` (a framed draft), `<CodeBlock>` (a code block, Mermaid included), `<Chart/>` (horizontal bars as ChatGPT draws them, line charts), `<AsyncImageGroup/>`, plain SVG drawings. Drawings that ChatGPT computes with template code (`{#each}`, expressions) are not run; a placeholder is shown. Inputs (`<radio>`, `<checkbox>`, `<slider>`, `<button>`) are shown disabled.
- as inline code in the text: `` `<Cite …/>` `` → a source chip (click to open the turn's `sources` list), `` `<FileCite name="…" …/>` `` → a file chip, `` `<MemoryCite/>` `` → a memory chip, `` `<icon …/>` `` → an icon, `` `<Entity value="…"/>` `` → its name as plain text, `` `<AsyncImage query="…"/>` `` → an image (see below), `` `<badge>…</badge>` `` / `` `<text>…</text>` ``.

ChatGPT's export does not record which search result each `<Cite>` mark points to, so a chip opens the turn's whole source list rather than one page.

### Making such notes from a ChatGPT export

`tools/chatgpt-export-to-md.py` turns a ChatGPT data export (Settings → Data controls → Export) into one note per conversation in this form. It needs only Python 3 and sends nothing anywhere:

```bash
python3 tools/chatgpt-export-to-md.py ~/Downloads/chatgpt-export.zip ~/MyVault/ChatGPT
```

If you already have your own importer, `tools/chatgpt_markup.py` holds the conversion (`normalize`, `sources`, `name_filecites`) and running it twice changes nothing.

## Settings

Every kind of part can be turned on or off on its own (source chips, source lists, file chips, terms, icons, images, charts, drafts, layouts, maps, choice questions, math, others). A part that is off shows its raw text.

## Network and privacy

GenUI Render sends nothing unless you ask for it:

- **Maps**: only after you press **Show map**, the place names and addresses of that block go to OpenStreetMap Nominatim (one request per second) and map tiles load from `tile.openstreetmap.org`. Coordinates are cached in the plugin data.
- **Images** (`<AsyncImage>`), **off by default**: when you turn it on, the query of each image is sent to Openverse (`api.openverse.org`), then Wikimedia Commons if nothing is found. The first result is shrunk to the image's width and saved as JPEG in a vault folder (setting, default `chatgpt-ui-images/`) with an `index.json` recording the query, source page, title, author and license; it is fetched only once. Hover an image for its credit, click to open its source page. Pictures found this way are guesses for the query, not the image ChatGPT showed, and keep their own licenses. If you sync the vault with git you may want to ignore the folder.

No telemetry, no accounts, no keys.

## Notes

- **Save answers** rewrites the code block; an importer that regenerates the note will lose the answers.
- Map data © OpenStreetMap contributors. Images © their authors, see `index.json`.

## Install

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/genui-render/` and enable **GenUI Render** in Settings → Community plugins.

## License

MIT
