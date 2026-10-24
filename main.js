'use strict';
/*
 * GenUI Render — draw ChatGPT "Intelligent UI" parts kept as ```chatgpt-ui code blocks.
 *
 * Block:   ```chatgpt-ui
 *          {"map_widget": {"points": [{"name": "...", "address": "..."}], "answer": "..."}}
 *          ```
 * Parts:   map_widget            place cards; a map is drawn only when you press "Show map"
 *          ask_user_input        single / multi select and free text; answers are saved into the block
 *          math_block_*          display math
 *          suggest_automation    small card
 *          sources               the search results of the turn (added by the importer for <Cite/> marks)
 *
 * Block:   ```chatgpt-jsx  — ChatGPT's JSX-like layout markup (<box>, <row>, <text>, <WritingBlock>, <Chart/> …)
 * Inline:  `<Cite …/>` `<Entity …/>` `<AsyncImage …/>` `<icon …/>` as inline code → chips (Reading view)
 *          anything else         part name + formatted JSON
 *
 * Network: only after "Show map" — Nominatim (geocoding, cached) and OpenStreetMap tiles.
 */
const { Plugin, PluginSettingTab, Setting, MarkdownRenderer, MarkdownRenderChild, Notice, requestUrl, moment, setIcon } = require('obsidian');

const BLOCK = 'chatgpt-ui';
const TILE = 256;
const DEFAULT_SETTINGS = {
  language: 'auto', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', geocache: {},
  // each part can be turned off; off = its raw text is shown. image is off by default because it uses the network
  parts: { cite: true, sources: true, filecite: true, entity: true, icon: true, image: false, chart: true, writing: true, layout: true, map: true, ask: true, math: true, other: true },
  imageFolder: 'chatgpt-ui-images',
};
const PART_NAMES = {
  cite: ['Source chips (<Cite>)', '出典チップ(<Cite>)'],
  sources: ['Source lists', '出典一覧'],
  filecite: ['File and memory chips (<FileCite>, <MemoryCite>)', 'ファイル・メモリのチップ(<FileCite>・<MemoryCite>)'],
  entity: ['Terms (<Entity>) as plain text', '用語(<Entity>)を文字で表示'],
  icon: ['Icons (<icon>)', 'アイコン(<icon>)'],
  image: ['Images (<AsyncImage>) — looks up pictures on Openverse / Wikimedia Commons (network)', '画像(<AsyncImage>)— Openverse・Wikimedia Commons で画像を探す(通信あり)'],
  chart: ['Charts (<Chart>)', 'グラフ(<Chart>)'],
  writing: ['Writing drafts (<WritingBlock>)', '文章作成(<WritingBlock>)'],
  layout: ['Layouts (<box>, <row>, <grid>, <text>…)', '枠組み(<box>・<row>・<grid>・<text> など)'],
  map: ['Maps (map_widget)', '地図(map_widget)'],
  ask: ['Choice questions (ask_user_input)', '選択肢(ask_user_input)'],
  math: ['Math blocks', '数式ブロック'],
  other: ['Other parts', 'その他の部品'],
};
const INLINE_PART = { Cite: 'cite', FileCite: 'filecite', MemoryCite: 'filecite', Entity: 'entity', icon: 'icon', AsyncImage: 'image', badge: 'layout', text: 'layout' };

const STR = {
  en: {
    showMap: 'Show map', hideMap: 'Hide map', locating: 'Looking up places…', notFound: 'Not found on the map',
    mapNote: 'Place names are sent to OpenStreetMap (Nominatim) to draw the map.',
    google: 'Google Maps', apple: 'Apple Maps', submit: 'Save answers', saved: 'Answers saved to the note',
    saveFail: 'Could not find this block in the note', other: 'Other…', automation: 'Suggested automation',
    unknown: 'ChatGPT UI part', invalid: 'Unreadable ChatGPT UI block', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    multi: 'Choose any', single: 'Choose one', answered: 'Answered',
    sources: 'Sources', cite: 'Source', file: 'File', memory: 'Memory', draft: 'Writing', copy: 'Copy', copied: 'Copied',
    svgSkipped: 'A drawing that ChatGPT computes with code (not run here)', noSources: 'The export does not keep which source this mark points to, and this turn has no source list.', searchImages: 'Search images', image: 'Image',
  },
  ja: {
    showMap: '地図を表示', hideMap: '地図を閉じる', locating: '場所を検索中…', notFound: '地図上で見つからない',
    mapNote: '地図を描くため、場所の名前を OpenStreetMap(Nominatim)へ送ります。',
    google: 'Google マップ', apple: 'Apple マップ', submit: '回答を保存', saved: '回答をノートに保存しました',
    saveFail: 'ノート内でこのブロックが見つかりません', other: 'その他…', automation: '自動化の提案',
    unknown: 'ChatGPT の画面部品', invalid: '読めない ChatGPT UI ブロック', zoomIn: '拡大', zoomOut: '縮小',
    multi: '複数選択可', single: '1つ選択', answered: '回答済み',
    sources: '出典', cite: '出典', file: 'ファイル', memory: 'メモリ', draft: '文章作成', copy: 'コピー', copied: 'コピーしました',
    svgSkipped: 'ChatGPT がコードで描く図(ここでは実行しない)', noSources: 'エクスポートにはこの印がどの出典を指すかが残っておらず、このターンには出典一覧もありません。', searchImages: '画像を検索', image: '画像',
  },
};

// Web Mercator
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

class GenUIRender extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.parts = Object.assign({}, DEFAULT_SETTINGS.parts, this.settings.parts);
    this.registerMarkdownCodeBlockProcessor(BLOCK, (src, el, ctx) => this.render(src, el, ctx));
    this.registerMarkdownCodeBlockProcessor('chatgpt-jsx', (src, el, ctx) => {
      if (!this.on('layout')) return this.raw(el, src, 'chatgpt-jsx');
      const child = new MarkdownRenderChild(el);
      ctx.addChild(child);
      new JsxRenderer(this, ctx, child).children(el.createDiv({ cls: 'genui genui-jsx' }), parseJsx(src));
    });
    this.registerMarkdownPostProcessor((el) => this.upgradeInlineCode(el));
    this.addSettingTab(new GenUISettingTab(this.app, this));
  }

  on(part) { return this.settings.parts[part] !== false; }

  raw(el, src, lang) {
    el.createEl('pre', { cls: 'language-' + lang }).createEl('code', { text: src });
  }

  rerender() { this.app.workspace.getLeavesOfType('markdown').forEach((l) => l.view.previewMode && l.view.previewMode.rerender(true)); }

  t(key) {
    let lang = this.settings.language;
    if (lang === 'auto') lang = (moment.locale() || 'en').startsWith('ja') ? 'ja' : 'en';
    return (STR[lang] || STR.en)[key];
  }

  async saveSettings() { await this.saveData(this.settings); }

  render(src, el, ctx) {
    const root = el.createDiv({ cls: 'genui' });
    let data;
    try { data = JSON.parse(src); } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      root.addClass('genui-generic');
      root.createDiv({ cls: 'genui-label', text: this.t('invalid') });
      root.createEl('pre').createEl('code', { text: src });
      return;
    }
    const partOf = (k) => (k === 'map_widget' ? 'map' : k === 'ask_user_input' ? 'ask' : k.startsWith('math_block') ? 'math' : k === 'sources' ? 'sources' : 'other');
    if (Object.keys(data).some((k) => !this.on(partOf(k)))) { root.remove(); return this.raw(el, src, BLOCK); }
    for (const [kind, body] of Object.entries(data)) {
      const part = root.createDiv({ cls: 'genui-part' });
      if (kind === 'map_widget') this.renderMap(part, body || {}, ctx);
      else if (kind === 'ask_user_input') this.renderAsk(part, body || {}, el, ctx, data);
      else if (kind.startsWith('math_block')) this.renderMath(part, body || {}, ctx);
      else if (kind === 'suggest_automation') this.renderAutomation(part, body || {});
      else if (kind === 'sources') this.renderSources(part, Array.isArray(body) ? body : []);
      else this.renderGeneric(part, kind, body);
    }
  }

  // ---- map_widget ----
  renderMap(part, body, ctx) {
    part.addClass('genui-map');
    const points = Array.isArray(body.points) ? body.points : [];
    if (body.answer) part.createDiv({ cls: 'genui-map-answer', text: body.answer });
    const mapBox = part.createDiv({ cls: 'genui-map-canvas-wrap' });
    mapBox.hide();
    const list = part.createEl('ol', { cls: 'genui-map-list' });
    const rows = points.map((p, i) => {
      const li = list.createEl('li', { cls: 'genui-place' });
      li.createSpan({ cls: 'genui-pin-num', text: String(i + 1) });
      const info = li.createDiv({ cls: 'genui-place-info' });
      info.createDiv({ cls: 'genui-place-name', text: p.name || p.address || '?' });
      const sub = [p.category, p.address].filter(Boolean).join(' · ');
      if (sub) info.createDiv({ cls: 'genui-place-sub', text: sub });
      const status = info.createDiv({ cls: 'genui-place-status' });
      const links = li.createDiv({ cls: 'genui-place-links' });
      const q = encodeURIComponent([p.name, p.address].filter(Boolean).join(' '));
      links.createEl('a', { text: this.t('google'), href: `https://www.google.com/maps/search/?api=1&query=${q}` });
      links.createEl('a', { text: this.t('apple'), href: `https://maps.apple.com/?q=${q}` });
      li.addEventListener('mouseenter', () => mapBox.querySelector(`.genui-pin[data-i="${i}"]`)?.addClass('is-hover'));
      li.addEventListener('mouseleave', () => mapBox.querySelector(`.genui-pin[data-i="${i}"]`)?.removeClass('is-hover'));
      return { li, status };
    });
    const bar = part.createDiv({ cls: 'genui-map-bar' });
    const btn = bar.createEl('button', { cls: 'genui-btn', text: this.t('showMap') });
    bar.createSpan({ cls: 'genui-map-note', text: this.t('mapNote') });
    let map = null;
    btn.addEventListener('click', async () => {
      if (map) { mapBox.toggle(mapBox.isShown() ? false : true); btn.setText(mapBox.isShown() ? this.t('hideMap') : this.t('showMap')); return; }
      btn.disabled = true; btn.setText(this.t('locating'));
      const coords = [];
      for (let i = 0; i < points.length; i++) {
        const c = await this.geocode(points[i]);
        coords.push(c);
        if (!c) rows[i].status.setText(this.t('notFound'));
      }
      btn.disabled = false; btn.setText(this.t('hideMap'));
      mapBox.show();
      map = new TileMap(mapBox, coords, this);
      ctx.addChild(map);
    });
  }

  async geocode(p) {
    const q = [p.name, p.address].filter(Boolean).join(', ');
    const tries = p.address ? [p.address, q] : [q]; // a bare address matches far more often than name + address
    for (const key of tries) {
      if (key in this.settings.geocache) { if (this.settings.geocache[key]) return this.settings.geocache[key]; continue; }
      let hit = null;
      try {
        const r = await requestUrl({
          url: `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(key)}`,
          headers: { 'User-Agent': 'obsidian-genui-render', 'Accept-Language': moment.locale() || 'en' },
        });
        const j = r.json;
        if (Array.isArray(j) && j[0]) hit = { lat: +j[0].lat, lon: +j[0].lon };
      } catch (e) { console.warn('genui-render: geocode failed', e); return null; }
      this.settings.geocache[key] = hit;
      await this.saveSettings();
      await new Promise((res) => setTimeout(res, 1100)); // Nominatim usage policy: max 1 request/s
      if (hit) return hit;
    }
    return null;
  }

  // ---- ask_user_input ----
  renderAsk(part, body, el, ctx, data) {
    part.addClass('genui-ask');
    const qs = Array.isArray(body.questions) ? body.questions : [];
    const state = qs.map((q) => ({
      selected: new Set(Array.isArray(q.selected) ? q.selected : []),
      free: typeof q.free_text === 'string' ? q.free_text : '',
    }));
    const answered = qs.some((q) => 'selected' in q || 'free_text' in q);
    qs.forEach((q, qi) => {
      const box = part.createDiv({ cls: 'genui-question' });
      const head = box.createDiv({ cls: 'genui-question-head' });
      head.createDiv({ cls: 'genui-question-text', text: q.question || '' });
      const multi = q.type === 'multi_select';
      head.createDiv({ cls: 'genui-question-type', text: multi ? this.t('multi') : this.t('single') });
      const opts = box.createDiv({ cls: 'genui-options' });
      const chips = [];
      (q.options || []).forEach((o) => {
        const chip = opts.createEl('button', { cls: 'genui-chip', text: String(o) });
        chip.toggleClass('is-selected', state[qi].selected.has(o));
        chip.setAttr('aria-pressed', String(state[qi].selected.has(o)));
        chip.addEventListener('click', () => {
          const s = state[qi].selected;
          if (multi) { s.has(o) ? s.delete(o) : s.add(o); } else { const had = s.has(o); s.clear(); if (!had) s.add(o); }
          chips.forEach(([c, v]) => { c.toggleClass('is-selected', s.has(v)); c.setAttr('aria-pressed', String(s.has(v))); });
        });
        chips.push([chip, o]);
      });
      if (q.free_text_placeholder !== undefined) {
        const input = box.createEl('input', { cls: 'genui-free', type: 'text', placeholder: q.free_text_placeholder || this.t('other') });
        input.value = state[qi].free;
        input.addEventListener('input', () => { state[qi].free = input.value; });
      }
    });
    const bar = part.createDiv({ cls: 'genui-ask-bar' });
    if (answered) bar.createSpan({ cls: 'genui-answered', text: this.t('answered') });
    const save = bar.createEl('button', { cls: 'genui-btn mod-cta', text: this.t('submit') });
    save.addEventListener('click', async () => {
      qs.forEach((q, qi) => {
        q.selected = (q.options || []).filter((o) => state[qi].selected.has(o));
        q.free_text = state[qi].free;
      });
      const ok = await this.writeBack(el, ctx, data);
      new Notice(ok ? this.t('saved') : this.t('saveFail'));
    });
  }

  async writeBack(el, ctx, data) {
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getFileByPath ? this.app.vault.getFileByPath(ctx.sourcePath) : this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !file) return false;
    let ok = false;
    await this.app.vault.process(file, (text) => {
      const lines = text.split('\n');
      const open = lines[info.lineStart] || '';
      if (!open.trimStart().startsWith('```' + BLOCK) || !(lines[info.lineEnd] || '').trimStart().startsWith('```')) return text;
      const indent = open.slice(0, open.length - open.trimStart().length);
      const body = JSON.stringify(data, null, 1).split('\n').map((l) => indent + l);
      lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...body);
      ok = true;
      return lines.join('\n');
    });
    return ok;
  }

  // ---- math ----
  renderMath(part, body, ctx) {
    part.addClass('genui-math');
    const tex = String(body.content || '').trim();
    const child = new MarkdownRenderChild(part);
    ctx.addChild(child);
    MarkdownRenderer.render(this.app, '$$\n' + tex + '\n$$', part, ctx.sourcePath, child);
  }

  // ---- sources (search results of the turn) ----
  renderSources(part, items) {
    part.addClass('genui-sources');
    const d = part.createEl('details');
    const sum = d.createEl('summary');
    sum.createSpan({ cls: 'genui-sources-title', text: `${this.t('sources')} · ${items.length}` });
    const sites = [...new Set(items.map((x) => x.site).filter(Boolean))];
    sum.createSpan({ cls: 'genui-sources-sites', text: sites.slice(0, 4).join(', ') + (sites.length > 4 ? ` +${sites.length - 4}` : '') });
    const ol = d.createEl('ol');
    items.forEach((x) => {
      const li = ol.createEl('li');
      li.createEl('a', { text: x.title || x.url, href: x.url });
      if (x.site) li.createSpan({ cls: 'genui-source-site', text: x.site });
    });
  }

  // ---- inline tags kept as inline code ----
  upgradeInlineCode(root) {
    root.querySelectorAll('code').forEach((code) => {
      if (code.closest('pre') || code.closest('.genui-chip')) return;
      const src = code.textContent.trim();
      if (!INLINE_CODE.test(src)) return;
      const node = parseJsx(src).find((n) => n.tag);
      if (!node || !this.on(INLINE_PART[node.tag] || 'other')) return;
      const el = this.inlineTag(node);
      if (el) code.replaceWith(el);
    });
  }

  inlineTag(n) {
    const a = n.attrs;
    const span = createSpan();
    if (n.tag === 'Cite' || n.tag === 'FileCite' || n.tag === 'MemoryCite') {
      const refs = Array.isArray(a.refs) ? a.refs : a.ref ? [a.ref] : [];
      span.addClass('genui-chip');
      const ic = span.createSpan({ cls: 'genui-chip-icon' });
      setIcon(ic, n.tag === 'Cite' ? 'globe' : n.tag === 'FileCite' ? 'file-text' : 'brain');
      const label = n.tag === 'Cite' ? this.t('cite') : n.tag === 'FileCite' ? (a.name || this.t('file')) : this.t('memory');
      span.createSpan({ cls: 'genui-chip-label', text: label });
      if (refs.length > 1 && n.tag === 'Cite') span.createSpan({ cls: 'genui-chip-more', text: `+${refs.length - 1}` });
      if (n.tag === 'FileCite' && a.line_range_start) span.setAttr('aria-label', `${a.name || ''} L${a.line_range_start}–${a.line_range_end}`);
      if (n.tag === 'Cite') {
        span.setAttr('role', 'button'); span.setAttr('tabindex', '0');
        const go = () => {
          const scope = span.closest('.markdown-preview-view, .markdown-reading-view, .cm-editor') || document;
          const list = [...scope.querySelectorAll('.genui-sources')].find((x) => span.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!list) { new Notice(this.t('noSources')); return; }
          const det = list.querySelector('details'); if (det) det.open = true;
          list.scrollIntoView({ behavior: 'smooth', block: 'center' });
          list.addClass('is-flash'); setTimeout(() => list.removeClass('is-flash'), 1200);
        };
        span.addEventListener('click', go);
        span.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      }
      return span;
    }
    if (n.tag === 'Entity') {
      return document.createTextNode(String(a.value || ''));   // ChatGPT's term sheet is not in the export; the name alone reads as plain text
    }
    if (n.tag === 'icon') {
      span.addClass('genui-icon');
      setIcon(span, String(a.name || ''));
      if (!span.querySelector('svg')) span.setText(a.name === 'check-circle' ? '✓' : '•');
      if (a.color) span.style.color = COLOR[a.color] || a.color;
      if (a.size) span.addClass('is-' + a.size);
      return span;
    }
    if (n.tag === 'AsyncImage') return this.imageCard(span, a);
    if (n.tag === 'badge' || n.tag === 'text') {
      span.addClass('genui-' + n.tag);
      if (n.tag === 'badge' && a.color) span.addClass('is-' + a.color);
      if (n.tag === 'text' && a.color) span.style.color = COLOR[a.color] || a.color;
      if (a.size) span.style.fontSize = SIZE[a.size] || a.size;
      span.setText(n.children.map((c) => c.text || '').join(''));
      return span;
    }
    return null;
  }

  // AsyncImage: ChatGPT shows a picture found for the query. Only when the image part is on, we look one up on
  // Openverse (then Wikimedia Commons), shrink it to maxWidth and keep it in the vault so it is fetched once.
  imageCard(parent, a) {
    const card = parent.createSpan({ cls: 'genui-image' });
    const [w, h] = String(a.aspectRatio || '4:3').split(':').map(Number);
    if (w && h) card.style.aspectRatio = `${w} / ${h}`;
    if (a.maxWidth) card.style.maxWidth = a.maxWidth;
    const placeholder = () => {
      card.empty();
      const ic = card.createSpan({ cls: 'genui-image-icon' }); setIcon(ic, 'image');
      card.createSpan({ cls: 'genui-image-query', text: a.query || this.t('image') });
    };
    placeholder();
    const query = Array.isArray(a.query) ? a.query[0] : a.query;
    if (!query || !this.on('image')) return card;
    const maxW = parseInt(a.maxWidth, 10) || 480;
    this.cachedImage(String(query), maxW).then((hit) => {
      if (!hit) return;
      card.empty(); card.addClass('has-image');
      const img = card.createEl('img', { attr: { src: this.app.vault.adapter.getResourcePath(hit.path), alt: query, loading: 'lazy' } });
      const credit = [hit.title, hit.creator, hit.license, hit.source].filter(Boolean).join(' · ');
      img.setAttr('title', credit);
      card.addEventListener('click', () => { if (hit.page) window.open(hit.page); });
    }).catch((e) => console.warn('genui-render: image', e));
    return card;
  }

  async imageIndex() {
    if (this._imgIndex) return this._imgIndex;
    const path = `${this.imageDir()}/index.json`;
    try { this._imgIndex = JSON.parse(await this.app.vault.adapter.read(path)); } catch (e) { this._imgIndex = {}; }
    return this._imgIndex;
  }

  imageDir() { return (this.settings.imageFolder || DEFAULT_SETTINGS.imageFolder).replace(/^\/+|\/+$/g, ''); }

  cachedImage(query, maxW) {
    const key = `${query}|${maxW}`;
    this._imgJobs = this._imgJobs || {};
    if (!this._imgJobs[key]) {
      this._imgChain = (this._imgChain || Promise.resolve()).then(() => this.fetchImage(query, maxW, key)).catch(() => null);
      this._imgJobs[key] = this._imgChain;
    }
    return this._imgJobs[key];
  }

  async fetchImage(query, maxW, key) {
    const idx = await this.imageIndex();
    const ad = this.app.vault.adapter, dir = this.imageDir();
    if (key in idx) return idx[key] && (await ad.exists(idx[key].path)) ? idx[key] : idx[key] === null ? null : this.fetchImage2(query, maxW, key);
    return this.fetchImage2(query, maxW, key);
  }

  async fetchImage2(query, maxW, key) {
    const idx = await this.imageIndex();
    const ad = this.app.vault.adapter, dir = this.imageDir();
    let found = null;
    try {
      const r = await requestUrl({ url: `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=1&mature=false`, headers: { 'User-Agent': 'obsidian-genui-render' } });
      const x = (r.json.results || [])[0];
      if (x) found = { url: x.thumbnail || x.url, page: x.foreign_landing_url, title: x.title, creator: x.creator, license: [x.license, x.license_version].filter(Boolean).join(' ').toUpperCase(), source: 'Openverse' };
    } catch (e) { /* try Commons */ }
    if (!found) {
      try {
        const r = await requestUrl({ url: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${maxW}` });
        const pg = Object.values((r.json.query || {}).pages || {})[0];
        const ii = pg && pg.imageinfo && pg.imageinfo[0];
        if (ii) {
          const md = ii.extmetadata || {};
          const strip = (v) => (v && v.value ? String(v.value).replace(/<[^>]+>/g, '') : '');
          found = { url: ii.thumburl || ii.url, page: ii.descriptionurl, title: pg.title.replace(/^File:/, ''), creator: strip(md.Artist), license: strip(md.LicenseShortName), source: 'Wikimedia Commons' };
        }
      } catch (e) { return null; }   // offline: do not record, try again next time
    }
    if (!found) { idx[key] = null; await this.saveImageIndex(); return null; }
    const bin = (await requestUrl({ url: found.url })).arrayBuffer;
    const small = await shrinkImage(bin, maxW);
    if (!(await ad.exists(dir))) await ad.mkdir(dir);
    const path = `${dir}/${hashString(key)}.jpg`;
    await ad.writeBinary(path, small);
    const { url, ...meta } = found;
    idx[key] = { path, query, ...meta, image: url, fetched: new Date().toISOString().slice(0, 10) };
    await this.saveImageIndex();
    return idx[key];
  }

  async saveImageIndex() {
    const ad = this.app.vault.adapter, dir = this.imageDir();
    if (!(await ad.exists(dir))) await ad.mkdir(dir);
    await ad.write(`${dir}/index.json`, JSON.stringify(this._imgIndex, null, 1));
  }

  // ---- suggest_automation ----
  renderAutomation(part, body) {
    part.addClass('genui-automation');
    part.createSpan({ cls: 'genui-automation-icon', text: '⏰' });
    const box = part.createDiv();
    box.createDiv({ cls: 'genui-label', text: this.t('automation') });
    box.createDiv({ cls: 'genui-automation-text', text: body.label || '' });
  }

  // ---- anything else ----
  renderGeneric(part, kind, body) {
    part.addClass('genui-generic');
    const d = part.createEl('details');
    const s = d.createEl('summary');
    s.createSpan({ cls: 'genui-label', text: this.t('unknown') + ': ' });
    s.createEl('code', { text: kind });
    if (body && typeof body.title === 'string') s.createSpan({ text: ' — ' + body.title });
    d.createEl('pre').createEl('code', { text: JSON.stringify(body, null, 2) });
  }
}

// A small slippy map: fit to points, +/- zoom, drag to pan.
class TileMap extends MarkdownRenderChild {
  constructor(box, coords, plugin) {
    super(box);
    this.box = box; this.coords = coords; this.plugin = plugin;
    box.empty();
    this.view = box.createDiv({ cls: 'genui-map-canvas' });
    this.layer = this.view.createDiv({ cls: 'genui-map-layer' });
    const ctl = box.createDiv({ cls: 'genui-map-zoom' });
    ctl.createEl('button', { text: '+', attr: { 'aria-label': plugin.t('zoomIn') } }).onclick = () => this.zoomBy(1);
    ctl.createEl('button', { text: '−', attr: { 'aria-label': plugin.t('zoomOut') } }).onclick = () => this.zoomBy(-1);
    box.createDiv({ cls: 'genui-map-attr', text: '© OpenStreetMap contributors' });
    this.fit();
    this.dragging();
    this.registerDomEvent(window, 'resize', () => this.draw());
  }

  size() { return { w: this.view.clientWidth || 600, h: this.view.clientHeight || 320 }; }

  fit() {
    const pts = this.coords.filter(Boolean);
    const { w, h } = this.size();
    if (!pts.length) { this.z = 1; this.cx = lon2x(0, 1); this.cy = lat2y(20, 1); return this.draw(); }
    let z = 16;
    for (; z > 1; z--) {
      const xs = pts.map((p) => lon2x(p.lon, z)), ys = pts.map((p) => lat2y(p.lat, z));
      if (Math.max(...xs) - Math.min(...xs) < w - 80 && Math.max(...ys) - Math.min(...ys) < h - 80) break;
    }
    if (pts.length === 1) z = 15;
    const xs = pts.map((p) => lon2x(p.lon, z)), ys = pts.map((p) => lat2y(p.lat, z));
    this.z = z; this.cx = (Math.max(...xs) + Math.min(...xs)) / 2; this.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    this.draw();
  }

  zoomBy(d) {
    const z = Math.max(1, Math.min(18, this.z + d));
    const f = 2 ** (z - this.z);
    this.cx *= f; this.cy *= f; this.z = z;
    this.draw();
  }

  dragging() {
    let start = null;
    this.registerDomEvent(this.view, 'pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
      this.view.setPointerCapture(e.pointerId);
    });
    this.registerDomEvent(this.view, 'pointermove', (e) => {
      if (!start) return;
      this.cx = start.cx - (e.clientX - start.x); this.cy = start.cy - (e.clientY - start.y);
      this.draw();
    });
    this.registerDomEvent(this.view, 'pointerup', () => { start = null; });
    this.registerDomEvent(this.view, 'dblclick', () => this.zoomBy(1));
  }

  draw() {
    const { w, h } = this.size();
    const z = this.z, n = 2 ** z;
    const left = this.cx - w / 2, top = this.cy - h / 2;
    this.layer.empty();
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const x = ((tx % n) + n) % n;
        const img = this.layer.createEl('img', { cls: 'genui-tile', attr: { alt: '', draggable: 'false' } });
        img.src = this.plugin.settings.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', ty);
        img.style.left = `${tx * TILE - left}px`; img.style.top = `${ty * TILE - top}px`;
      }
    }
    this.coords.forEach((c, i) => {
      if (!c) return;
      const pin = this.layer.createDiv({ cls: 'genui-pin', text: String(i + 1), attr: { 'data-i': i } });
      pin.style.left = `${lon2x(c.lon, z) - left}px`; pin.style.top = `${lat2y(c.lat, z) - top}px`;
    });
  }
}

class GenUISettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; const p = this.plugin;
    containerEl.empty();
    new Setting(containerEl).setName('Language / 言語').addDropdown((d) => d
      .addOptions({ auto: 'Auto', en: 'English', ja: '日本語' }).setValue(p.settings.language)
      .onChange(async (v) => { p.settings.language = v; await p.saveSettings(); }));
    const ja = p.t('draft') === '文章作成';
    containerEl.createEl('h3', { text: ja ? '描画する部品(オフ = 元の文字のまま)' : 'Parts to draw (off = raw text)' });
    for (const [k, names] of Object.entries(PART_NAMES)) {
      new Setting(containerEl).setName(ja ? names[1] : names[0])
        .addToggle((t) => t.setValue(p.settings.parts[k] !== false).onChange(async (v) => { p.settings.parts[k] = v; await p.saveSettings(); p.rerender(); }));
    }
    new Setting(containerEl).setName(ja ? '画像の保存先フォルダ' : 'Image folder')
      .setDesc(ja ? '見つけた画像を縮小してこの Vault 内フォルダに保存し、index.json に検索語・出典・ライセンスを記録します。' : 'Found pictures are shrunk and saved in this vault folder; index.json records the query, source and license.')
      .addText((t) => t.setValue(p.settings.imageFolder).onChange(async (v) => { p.settings.imageFolder = v.trim() || DEFAULT_SETTINGS.imageFolder; p._imgIndex = null; await p.saveSettings(); }));
    new Setting(containerEl).setName('Map tile URL / 地図タイル URL').setDesc('{z} {x} {y}')
      .addText((t) => t.setValue(p.settings.tileUrl).onChange(async (v) => { p.settings.tileUrl = v || DEFAULT_SETTINGS.tileUrl; await p.saveSettings(); }));
    new Setting(containerEl).setName('Clear place cache / 場所のキャッシュを消す')
      .setDesc(`${Object.keys(p.settings.geocache).length}`)
      .addButton((b) => b.setButtonText('Clear').onClick(async () => { p.settings.geocache = {}; await p.saveSettings(); this.display(); }));
  }
}

// ---- JSX-like markup in newer ChatGPT answers (```chatgpt-jsx blocks and `<Cite …/>` inline code) ----

const INLINE_TAGS = new Set(['Cite', 'FileCite', 'MemoryCite', 'Entity', 'AsyncImage', 'icon', 'Link', 'math']);
const INLINE_CODE = /^(?:<(Cite|FileCite|MemoryCite|Entity|AsyncImage|icon)\b[\s\S]*\/>|<(badge|text)\b[^>]*>[^<]*<\/\2>)$/;

// Parse markup into [{text} | {tag, attrs, children}]
function parseJsx(src) {
  let i = 0;
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (t) => { if (t) top().children.push({ text: t }); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(src.slice(i)); break; }
    pushText(src.slice(i, lt));
    const close = /^<\/([A-Za-z][\w-]*)\s*>/.exec(src.slice(lt));
    if (close) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === close[1]) { stack.length = k; break; }
      i = lt + close[0].length;
      continue;
    }
    const open = /^<([A-Za-z][\w-]*)/.exec(src.slice(lt));
    if (!open) { pushText('<'); i = lt + 1; continue; }
    let j = lt + open[0].length;
    const attrs = {};
    let selfClose = false, ok = false;
    while (j < src.length) {
      while (/\s/.test(src[j])) j++;
      if (src.startsWith('/>', j)) { selfClose = true; j += 2; ok = true; break; }
      if (src[j] === '>') { j += 1; ok = true; break; }
      const name = /^[A-Za-z_][\w-]*/.exec(src.slice(j));
      if (!name) break;
      j += name[0].length;
      let val = true;
      if (src[j] === '=') {
        j++;
        if (src[j] === '"' || src[j] === "'") {
          const q = src[j], e = src.indexOf(q, j + 1);
          if (e < 0) break;
          val = src.slice(j + 1, e).replace(/\\#/g, '#'); j = e + 1;
        } else if (src[j] === '{') {
          let d = 0, k = j, inStr = null;
          for (; k < src.length; k++) {
            const c = src[k];
            if (inStr) { if (c === '\\') k++; else if (c === inStr) inStr = null; continue; }
            if (c === '"' || c === "'") inStr = c;
            else if (c === '{') d++;
            else if (c === '}' && --d === 0) break;
          }
          const raw = src.slice(j + 1, k).trim();
          try { val = JSON.parse(raw); } catch (e) { val = { __expr: raw }; }
          j = k + 1;
        } else {
          const bare = /^[^\s/>]+/.exec(src.slice(j));
          val = bare ? bare[0] : ''; j += val.length;
        }
      }
      attrs[name[0]] = val;
    }
    if (!ok) { pushText(src.slice(lt, j)); i = j; continue; }
    const node = { tag: open[1], attrs, children: [] };
    top().children.push(node);
    if (!selfClose) stack.push(node);
    i = j;
  }
  return root.children;
}

const COLOR = {
  success: 'var(--color-green)', danger: 'var(--color-red)', error: 'var(--color-red)', warning: 'var(--color-orange)',
  info: 'var(--color-blue)', primary: 'var(--text-normal)', secondary: 'var(--text-muted)', tertiary: 'var(--text-faint)',
  subtle: 'var(--background-modifier-border)', accent: 'var(--interactive-accent)',
};
const BG = { 'surface-secondary': 'var(--background-secondary)', 'surface-tertiary': 'var(--background-secondary-alt)', surface: 'var(--background-primary)' };
const RADIUS = { sm: '6px', md: '10px', lg: '14px', xl: '20px', full: '999px' };
const SIZE = { xs: 'var(--font-ui-smaller)', sm: 'var(--font-ui-small)', md: 'inherit', lg: '1.15em', xl: '1.35em', '2xl': '1.6em' };
const ALIGN = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around' };
const len = (v) => (typeof v === 'number' ? v * 4 + 'px' : String(v));

function dedent(t) { return t.split('\n').map((l) => l.replace(/^[ \t]+/, '')).join('\n'); }

// Serialize an inline tag back to source so it can travel through Markdown as inline code
function tagSource(n) {
  const a = Object.entries(n.attrs).map(([k, v]) => (v === true ? k : typeof v === 'string' ? `${k}="${v}"` : `${k}={${JSON.stringify(v)}}`)).join(' ');
  return `<${n.tag}${a ? ' ' + a : ''}/>`;
}

class JsxRenderer {
  constructor(plugin, ctx, component) { this.p = plugin; this.ctx = ctx; this.c = component; }

  flow(parent, md) {
    if (!md.trim()) return;
    const box = parent.createDiv({ cls: 'genui-flow' });
    MarkdownRenderer.render(this.p.app, md.trim(), box, this.ctx.sourcePath, this.c).then(() => this.p.upgradeInlineCode(box));
  }

  children(parent, nodes) {
    let md = '';
    const flush = () => { this.flow(parent, md); md = ''; };
    for (const n of nodes) {
      if (n.text !== undefined) md += dedent(n.text);
      else if (n.tag === 'Link') {
        const t = (n.attrs.title || n.children.map((c) => c.text || '').join('') || n.attrs.url || '').trim();
        md += `[${t.replace(/[[\]]/g, '\\$&')}](<${n.attrs.url || ''}>)`;
      } else if (n.tag === 'math') md += `$${n.attrs.value || ''}$`;
      else if (INLINE_TAGS.has(n.tag)) md += '`' + tagSource(n) + '`';
      else { flush(); this.node(parent, n); }
    }
    flush();
  }

  node(parent, n) {
    const a = n.attrs;
    const style = (el) => {
      if (a.gap !== undefined) el.style.gap = len(a.gap);
      if (a.padding !== undefined) el.style.padding = len(a.padding);
      if (a.radius) el.style.borderRadius = RADIUS[a.radius] || len(a.radius);
      if (a.background) el.style.background = BG[a.background] || COLOR[a.background] || 'var(--background-secondary)';
      if (a.border) {
        el.addClass('genui-bordered');
        const bc = /color\s*:\s*["']?(\w+)/.exec(typeof a.border === 'object' ? a.border.__expr || JSON.stringify(a.border) : '');
        if (bc && COLOR[bc[1]]) el.style.borderColor = COLOR[bc[1]];
      }
      if (a.width) el.style.width = len(a.width);
      if (a.flex !== undefined) el.style.flex = String(a.flex);
      if (a.align) el.style.alignItems = ALIGN[a.align] || a.align;
      if (a.justify) el.style.justifyContent = JUSTIFY[a.justify] || a.justify;
      return el;
    };
    switch (n.tag) {
      case 'box': case 'col': case 'grid-item': return this.children(style(parent.createDiv({ cls: 'genui-box' })), n.children);
      case 'row': {
        const el = style(parent.createDiv({ cls: 'genui-row' }));
        if (a.wrap) el.style.flexWrap = 'wrap';
        return this.children(el, n.children);
      }
      case 'grid': {
        const el = style(parent.createDiv({ cls: 'genui-grid' }));
        el.style.gridTemplateColumns = `repeat(${Number(a.columns) || 2}, minmax(0, 1fr))`;
        return this.children(el, n.children);
      }
      case 'list': return this.children(style(parent.createDiv({ cls: 'genui-box genui-list' })), n.children);
      case 'text': case 'caption': case 'badge': {
        const el = parent.createDiv({ cls: 'genui-' + n.tag });
        if (a.size) el.style.fontSize = SIZE[a.size] || a.size;
        if (a.weight) el.style.fontWeight = a.weight === 'semibold' ? '600' : a.weight === 'bold' ? '700' : a.weight === 'medium' ? '500' : a.weight;
        if (a.color && n.tag !== 'badge') el.style.color = COLOR[a.color] || a.color;
        if (n.tag === 'badge' && a.color) el.addClass('is-' + a.color);
        return this.children(el, n.children);
      }
      case 'title': {
        const el = parent.createDiv({ cls: 'genui-title' });
        if (a.size) el.style.fontSize = SIZE[a.size] || a.size;
        if (a.color) el.style.color = COLOR[a.color] || a.color;
        if (a.tabularNums) el.style.fontVariantNumeric = 'tabular-nums';
        return this.children(el, n.children);
      }
      case 'table': return this.children(parent.createDiv({ cls: 'genui-table' }), n.children);
      case 'table-row': {
        const el = parent.createDiv({ cls: 'genui-table-row' });
        el.style.gridTemplateColumns = `repeat(${n.children.filter((c) => c.tag).length || 1}, minmax(0, 1fr))`;
        return this.children(el, n.children);
      }
      case 'table-cell': return this.children(style(parent.createDiv({ cls: 'genui-table-cell' })), n.children);
      case 'list-item': {
        const el = parent.createDiv({ cls: 'genui-list-item' });
        el.createSpan({ cls: 'genui-list-marker', text: a.marker || (parent.closest('.genui-list') ? '•' : '•') });
        return this.children(el.createDiv({ cls: 'genui-box' }), n.children);
      }
      case 'button': {
        const b = parent.createEl('button', { cls: 'genui-btn genui-fake-btn' });
        b.disabled = true;
        b.setText(n.children.map((c) => c.text || '').join('').trim() || a.label || '');
        return b;
      }
      case 'label': return this.children(parent.createDiv({ cls: 'genui-caption' }), n.children);
      case 'radio-group': case 'segmented-control': {
        const el = parent.createDiv({ cls: 'genui-options' });
        const opts = Array.isArray(a.options) ? a.options : [];
        opts.forEach((o) => {
          const label = typeof o === 'object' ? o.label || o.value : o;
          const val = typeof o === 'object' ? o.value : o;
          el.createEl('span', { cls: 'genui-chip-static' + (a.value === val ? ' is-selected' : ''), text: String(label) });
        });
        return this.children(el, n.children);
      }
      case 'divider': return parent.createEl('hr', { cls: 'genui-divider' });
      case 'spacer': return parent.createDiv({ cls: 'genui-spacer' });
      case 'checkbox': case 'radio': {
        const el = parent.createEl('label', { cls: 'genui-input' });
        const inp = el.createEl('input', { type: n.tag });
        inp.checked = a.checked === true; inp.disabled = true;
        return this.children(el, n.children);
      }
      case 'slider': {
        const inp = parent.createEl('input', { type: 'range', cls: 'genui-slider' });
        ['min', 'max', 'step', 'value'].forEach((k) => { if (typeof a[k] === 'number') inp.setAttr(k, a[k]); });
        inp.disabled = true;
        return inp;
      }
      case 'WritingBlock': return this.p.on('writing') ? this.writing(parent, n) : this.children(parent, n.children);
      case 'CodeBlock': {
        const code = n.children.map((c) => (c.text !== undefined ? c.text : '')).join('').replace(/^\n+|\s+$/g, '');
        const tick = '`'.repeat(Math.max(3, ...(code.match(/`{3,}/g) || []).map((s) => s.length + 1)));
        return this.flowRaw(parent, `${tick}${a.language || ''}\n${code}\n${tick}`);
      }
      case 'Chart': if (!this.p.on('chart')) { parent.createEl('pre').createEl('code', { text: tagSource(n) }); return null; } return renderChart(parent, a.content, this.p);
      case 'svg': return isTemplated(n) ? this.templatedSvg(parent) : buildSvg(parent, n);
      case 'AsyncImageGroup': {
        const el = parent.createDiv({ cls: 'genui-imagegroup' });
        (Array.isArray(a.query) ? a.query : [a.query]).forEach((q) => this.p.imageCard(el, { query: q, aspectRatio: a.aspectRatio }));
        return el;
      }
      default: {
        if (INLINE_TAGS.has(n.tag)) return this.children(parent, [n]);
        const el = parent.createDiv({ cls: 'genui-box genui-unknown', attr: { 'data-tag': n.tag } });
        return this.children(el, n.children);
      }
    }
  }

  // Drawings that loop or compute coordinates would need ChatGPT's code to run; we do not run it
  templatedSvg(parent) {
    const el = parent.createDiv({ cls: 'genui-svg-skipped' });
    const ic = el.createSpan(); setIcon(ic, 'shapes');
    el.createSpan({ text: this.p.t('svgSkipped') });
    return el;
  }

  flowRaw(parent, md) {
    const box = parent.createDiv({ cls: 'genui-flow' });
    MarkdownRenderer.render(this.p.app, md, box, this.ctx.sourcePath, this.c);
    return box;
  }

  writing(parent, n) {
    const card = parent.createDiv({ cls: 'genui-writing' });
    const head = card.createDiv({ cls: 'genui-writing-head' });
    const ttl = head.createSpan({ cls: 'genui-writing-title' });
    setIcon(ttl.createSpan({ cls: 'genui-chip-icon' }), 'pencil');
    ttl.createSpan({ text: this.p.t('draft') });
    this.children(card.createDiv({ cls: 'genui-writing-body' }), n.children);
    return card;
  }
}

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function shrinkImage(buf, maxW) {
  const bmp = await createImageBitmap(new Blob([buf]));
  const scale = Math.min(1, maxW * (window.devicePixelRatio > 1 ? 2 : 1) / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
  return await blob.arrayBuffer();
}

function isTemplated(n) {
  if (n.text !== undefined) return /\{[#/:]/.test(n.text);
  return Object.values(n.attrs).some((v) => v && typeof v === 'object' && '__expr' in v) || n.children.some(isTemplated);
}

const SVG_OK = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'title']);
function buildSvg(parent, n) {
  const ns = 'http://www.w3.org/2000/svg';
  const make = (node) => {
    if (node.text !== undefined) return document.createTextNode(node.text.trim() ? node.text : '');
    if (!SVG_OK.has(node.tag)) return null;
    const e = document.createElementNS(ns, node.tag);
    for (const [k, v] of Object.entries(node.attrs)) {
      if (/^on/i.test(k) || /href$/i.test(k) || typeof v === 'object') continue;
      const name = k === 'viewBox' || k.startsWith('xmlns') || /^(markerWidth|markerHeight|refX|refY|gradientUnits|preserveAspectRatio)$/.test(k) ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      e.setAttribute(name, v === true ? '' : String(v));
    }
    node.children.forEach((c) => { const x = make(c); if (x) e.appendChild(x); });
    return e;
  };
  const svg = make(n);
  if (svg) { svg.classList.add('genui-svg'); parent.appendChild(svg); }
  return svg;
}

// Bars as ChatGPT draws them: a heading per category, then per series a label row (value right) and a thin bar on a track
function hbars(box, spec, xKey, series) {
  const max = Math.max(...spec.data.flatMap((d) => series.map((s) => Number(d[s.dataKey]) || 0)), 0) || 1;
  const suffix = (s) => (s && s.valueSuffix) || '';
  spec.data.forEach((d) => {
    const g = box.createDiv({ cls: 'genui-hbar-group' });
    if (series.length > 1) g.createDiv({ cls: 'genui-hbar-cat', text: String(d[xKey]) });
    series.forEach((s, si) => {
      const v = d[s.dataKey];
      if (v === undefined || v === null || v === '') return;
      const row = g.createDiv({ cls: 'genui-hbar-row' });
      const head = row.createDiv({ cls: 'genui-hbar-head' });
      head.createSpan({ text: series.length > 1 ? (s.label || s.dataKey) : String(d[xKey]) });
      head.createSpan({ cls: 'genui-hbar-value', text: Number(v).toLocaleString() + suffix(s) });
      const track = row.createDiv({ cls: 'genui-hbar-track' });
      track.createDiv({ cls: 'genui-hbar-fill s' + (si % 6) }).style.width = `${Math.max(1.5, (100 * (Number(v) || 0)) / max)}%`;
    });
  });
  const cap = [series.length === 1 && series[0].label, spec.meta && spec.meta.footer].filter(Boolean);
  cap.forEach((c) => box.createDiv({ cls: 'genui-chart-caption', text: c }));
  return box;
}

function renderChart(parent, spec, plugin) {
  const box = parent.createDiv({ cls: 'genui-chart' });
  if (!spec || !Array.isArray(spec.data) || !spec.data.length) { box.setText(plugin.t('unknown') + ': Chart'); return box; }
  const xKey = spec.xKey || Object.keys(spec.data[0])[0];
  const series = (spec.series || []).length ? spec.series : Object.keys(spec.data[0]).filter((k) => k !== xKey).map((k) => ({ dataKey: k, label: k }));
  const meta = spec.meta || {};
  if (spec.title || meta.title) box.createDiv({ cls: 'genui-chart-title', text: spec.title || meta.title });
  if (meta.subtitle || spec.subtitle) box.createDiv({ cls: 'genui-chart-caption', text: meta.subtitle || spec.subtitle });
  if (series.length > 1 && spec.chartType === 'line') {
    const lg = box.createDiv({ cls: 'genui-chart-legend' });
    series.forEach((s, i) => { const it = lg.createSpan({ cls: 'genui-legend-item' }); it.createSpan({ cls: 'genui-swatch s' + (i % 6) }); it.appendText(s.label || s.dataKey); });
  }
  if (spec.chartType !== 'line') return hbars(box, spec, xKey, series);
  const W = 560, H = 240, L = 44, R = 12, T = 12, B = 36;
  const vals = spec.data.flatMap((d) => series.map((s) => Number(d[s.dataKey]) || 0));
  const lo = Math.min(typeof spec.yAxisMin === 'number' ? spec.yAxisMin : 0, ...vals), hi = Math.max(...vals) || 1;
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const n = spec.data.length, bw = (W - L - R) / n;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'genui-chart-svg'); svg.setAttribute('role', 'img');
  const mk = (tag, at, parentEl = svg) => { const e = document.createElementNS(ns, tag); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); parentEl.appendChild(e); return e; };
  const suffix = (s) => (s && s.valueSuffix) || '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4, yy = y(v);
    mk('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'genui-grid-line' });
    mk('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', class: 'genui-axis' }).textContent = +v.toFixed(2);
  }
  spec.data.forEach((d, i) => { mk('text', { x: L + bw * (i + 0.5), y: H - B + 18, 'text-anchor': 'middle', class: 'genui-axis' }).textContent = String(d[xKey]); });
  series.forEach((s, si) => {
    if (spec.chartType === 'line') {
      const pts = spec.data.map((d, i) => [L + bw * (i + 0.5), y(Number(d[s.dataKey]) || 0)]);
      mk('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'genui-line s' + (si % 6) });
      pts.forEach(([px, py], i) => { const c = mk('circle', { cx: px, cy: py, r: 4, class: 'genui-dot s' + (si % 6) }); mk('title', {}, c).textContent = `${spec.data[i][xKey]}: ${spec.data[i][s.dataKey]}${suffix(s)}`; });
    } else {
      const gw = bw * 0.6, w = gw / series.length;
      spec.data.forEach((d, i) => {
        const v = Number(d[s.dataKey]) || 0, x0 = L + bw * i + (bw - gw) / 2 + w * si + 1, y0 = y(Math.max(v, lo)), yb = y(lo);
        const r = mk('rect', { x: x0, y: Math.min(y0, yb), width: Math.max(1, w - 2), height: Math.abs(yb - y0), rx: 4, class: 'genui-bar s' + (si % 6) });
        mk('title', {}, r).textContent = `${s.label || s.dataKey} — ${d[xKey]}: ${v}${suffix(s)}`;
        if (n * series.length <= 12) mk('text', { x: x0 + (w - 2) / 2, y: Math.min(y0, yb) - 4, 'text-anchor': 'middle', class: 'genui-value' }).textContent = v + suffix(s);
      });
    }
  });
  box.appendChild(svg);
  if (series.length === 1 && series[0].label) box.createDiv({ cls: 'genui-chart-caption', text: series[0].label });
  if (spec.meta && spec.meta.footer) box.createDiv({ cls: 'genui-chart-caption', text: spec.meta.footer });
  return box;
}

module.exports = GenUIRender;
