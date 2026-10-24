"""Make the JSX-like markup in ChatGPT answers safe for Markdown, in the form GenUI Render draws.

- layouts (<box>/<row>/<col>/<grid>/<list> trees), <WritingBlock>, <CodeBlock>, <svg>, <Chart/>, <AsyncImageGroup/>,
  one-line <caption>/<badge>/<text>/<divider/>  ->  wrapped in a ```chatgpt-jsx code block, unchanged inside
- inline <Cite/>, <FileCite/>, <MemoryCite/>, <Entity/>, <AsyncImage/>, <icon/>, <badge>…</badge>, <text>…</text>  ->  inline code
- <Link url="…" title="…"/>  ->  [title](url)
Running it again on its own output changes nothing.
"""
import json, re

LAYOUT = 'box|row|col|grid|list'
LAYOUT_TAG = re.compile(r'<(/?)(' + LAYOUT + r')\b((?:"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\}|[^>"{])*)>')
PAIRED = ('WritingBlock', 'CodeBlock', 'svg')
SINGLE = ('Chart', 'AsyncImageGroup', 'LearningViz', 'divider')
LINE = re.compile(r'^\s*<(caption|badge|text)\b[^>]*>.*</\1>\s*$')   # parts closed on one line
ATTRS = r'(?:\s+[A-Za-z_]+(?:=(?:"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\}|[^\s/>]+))?)*'
INLINE = re.compile(r'<(?:Cite|FileCite|MemoryCite|Entity|AsyncImage|icon)\b' + ATTRS + r'\s*/>')
PAIRED_INLINE = re.compile(r'<(badge|text)\b[^<>`]*>[^<>`\n]*</\1>')
LINK = re.compile(r'<Link\s+url="([^"]*)"(?:\s+title="([^"]*)")?\s*(?:/>|>([^<]*)</Link>)')
FENCE = re.compile(r'^\s*(`{3,}|~{3,})')
CODE_SPAN = re.compile(r'(`+)(?:(?!\1).)+?\1')


def _fence(lines):
    n = 3
    for l in lines:
        m = re.match(r'\s*(`{3,})', l)
        if m:
            n = max(n, len(m.group(1)) + 1)
    tick = '`' * n
    return [tick + 'chatgpt-jsx'] + lines + [tick]


def _layout_depth(line):
    d = 0
    for m in LAYOUT_TAG.finditer(line):
        if m.group(1):
            d -= 1
        elif not m.group(3).rstrip().endswith('/'):
            d += 1
    return d


def _block_end(lines, i):
    """Index of the last line of the part starting at lines[i], or None"""
    s = lines[i].lstrip()
    if LINE.match(lines[i]):
        return i
    if re.match(r'<(' + LAYOUT + r')\b', s):
        d = 0
        for j in range(i, min(len(lines), i + 400)):
            d += _layout_depth(lines[j])
            if d <= 0:
                return j
        return None
    for tag in PAIRED:
        if s.startswith('<' + tag):
            for j in range(i, min(len(lines), i + 400)):
                if '</' + tag + '>' in lines[j]:
                    return j
            return None
    for tag in SINGLE:
        if s.startswith('<' + tag):
            for j in range(i, min(len(lines), i + 50)):
                if lines[j].rstrip().endswith('/>'):
                    return j
            return None
    return None


def _inline(line):
    out, pos = [], 0
    for m in CODE_SPAN.finditer(line):
        out.append(_inline_plain(line[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_inline_plain(line[pos:]))
    return ''.join(out)


def _inline_plain(s):
    def code(m):
        t = m.group(0)
        return '`` ' + t + ' ``' if '`' in t else '`' + t + '`'
    def link(m):
        url, title = m.group(1), m.group(2) or (m.group(3) or '').strip() or m.group(1)
        return '[' + title.replace('[', '\\[').replace(']', '\\]') + '](<' + url + '>)'
    return LINK.sub(link, PAIRED_INLINE.sub(code, INLINE.sub(code, s)))


def normalize(text):
    lines, out, i, fence = text.split('\n'), [], 0, None
    while i < len(lines):
        line = lines[i]
        m = FENCE.match(line)
        if fence:
            out.append(line)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line.strip()[len(m.group(1)):].strip():
                fence = None
            i += 1
            continue
        if m:
            fence = m.group(1)
            out.append(line)
            i += 1
            continue
        j = _block_end(lines, i)
        if j is not None:
            out += _fence(lines[i:j + 1])
            i = j + 1
            continue
        out.append(_inline(line))
        i += 1
    return '\n'.join(out)


def sources(metas):
    """Search results from the metadata of the answer messages, de-duplicated by URL"""
    seen, out = set(), []
    for md in metas:
        for g in (md or {}).get('search_result_groups') or []:
            for e in g.get('entries') or []:
                url = re.sub(r'([?&])utm_source=chatgpt\.com(&|$)', lambda m: m.group(1) if m.group(2) else '', e.get('url') or '').rstrip('?&')
                if not url or url in seen:
                    continue
                seen.add(url)
                out.append({k: v for k, v in (('title', e.get('title')), ('url', url), ('site', e.get('attribution') or g.get('domain'))) if v})
    return out


def sources_block(items):
    if not items:
        return ''
    return '```chatgpt-ui\n' + json.dumps({'sources': items}, ensure_ascii=False, indent=1) + '\n```'


def name_filecites(text, names):
    """Add the attached file name (name="…") to <FileCite ref="turnNfileM"/>: the M-th attachment if present, else the last one"""
    if not names:
        return text
    def add(m):
        tag = m.group(0)
        if ' name=' in tag:
            return tag
        k = re.search(r'file(\d+)', tag)
        nm = names[int(k.group(1))] if k and int(k.group(1)) < len(names) else names[-1]
        return tag.replace('<FileCite', '<FileCite name="' + nm.replace('"', "'") + '"', 1)
    return re.sub(r'<FileCite\b[^>]*/>', add, text)
