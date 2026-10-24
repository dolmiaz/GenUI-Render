#!/usr/bin/env python3
"""Convert a ChatGPT data export into Markdown notes that GenUI Render can draw.

Usage:
  python3 chatgpt-export-to-md.py <export folder or .zip> <output folder>

One note per conversation (the branch you last saw), with "## You" / "## ChatGPT" sections.
Kept for GenUI Render:
- genui parts (maps, choice questions, math, …) as ```chatgpt-ui code blocks holding their JSON
- the JSX-like markup of newer answers, made Markdown-safe by chatgpt_markup.normalize
- for answers with <Cite/> marks, the search results of the turn as a ```chatgpt-ui {"sources": …} block
- attached file names on <FileCite/>
Existing notes with the same name are not overwritten. Nothing is sent anywhere.
"""
import datetime, glob, json, os, re, sys, tempfile, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chatgpt_markup as cm

PUA = re.compile('(\\w+)(.*?)', re.S)


def genui_block(raw):
    try:
        v = json.loads(raw)
    except Exception:
        return ''
    if not isinstance(v, dict) or list(v) == ['citation']:
        return ''
    return '\n\n```chatgpt-ui\n' + json.dumps(v, ensure_ascii=False, indent=1) + '\n```\n\n'


def clean(t):
    def pua(m):
        kind, body = m.group(1), m.group(2)
        if kind == 'entity':
            try:
                v = json.loads(body); return v[1] if isinstance(v, list) and len(v) > 1 else ''
            except Exception:
                return ''
        if kind == 'genui':
            return genui_block(body)
        if kind == 'url':
            title, _, url = body.partition('')
            return f'[{title}](<{url}>)' if url.startswith('http') else title
        return ''
    t = PUA.sub(pua, t or '')
    t = re.sub('[-]', '', t)
    t = re.sub(r'\\\[(.+?)\\\]', lambda m: '$$' + m.group(1).strip() + '$$', t, flags=re.S)
    t = re.sub(r'\\\((.+?)\\\)', lambda m: '$' + m.group(1).strip() + '$', t)
    return cm.normalize(re.sub(r'\n{3,}', '\n\n', t).strip())


def text_of(msg):
    c = msg.get('content') or {}
    if c.get('content_type') not in ('text', 'multimodal_text'):
        return None
    return '\n'.join(p if isinstance(p, str) else '(image)' for p in c.get('parts') or []
                     if isinstance(p, str) or (isinstance(p, dict) and p.get('content_type') == 'image_asset_pointer')).strip()


def turns_of(conv):
    mp, node, chain = conv['mapping'], conv.get('current_node'), []
    while node:
        n = mp.get(node) or {}
        if n.get('message'):
            chain.append(n['message'])
        node = n.get('parent')
    turns = []
    for m in reversed(chain):
        md = m.get('metadata') or {}
        if md.get('is_visually_hidden_from_conversation'):
            continue
        role, t = m['author']['role'], text_of(m)
        if role == 'user' and t is not None:
            att = [a.get('name') for a in md.get('attachments') or [] if a.get('name')]
            turns.append({'q': t, 'a': [], 'meta': [], 'files': att or (turns[-1]['files'] if turns else [])})
        elif role == 'assistant' and t and turns and (m.get('recipient') or 'all') == 'all':
            turns[-1]['a'].append(t); turns[-1]['meta'].append(md)
    return turns


def answer(t):
    body = cm.name_filecites(clean('\n\n'.join(t['a'])), t['files'])
    if '<Cite' in body:
        body += '\n\n' + cm.sources_block(cm.sources(t['meta']))
    return body.rstrip()


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    if zipfile.is_zipfile(src):
        tmp = tempfile.mkdtemp()
        with zipfile.ZipFile(src) as z:
            for name in z.namelist():
                if re.search(r'conversations[^/]*\.json$', name):
                    z.extract(name, tmp)
        src = tmp
    files = sorted(glob.glob(os.path.join(src, '**', 'conversations*.json'), recursive=True))
    if not files:
        raise SystemExit('no conversations*.json found in ' + sys.argv[1])
    os.makedirs(out, exist_ok=True)
    n = 0
    for fp in files:
        with open(fp, encoding='utf-8') as f:
            convs = json.load(f)
        for conv in convs:
            turns = turns_of(conv)
            if not turns:
                continue
            title = ''.join(ch for ch in (conv.get('title') or 'Untitled') if ch.isprintable() and not 0xE000 <= ord(ch) < 0xF900 and ord(ch) < 0xF0000).strip() or 'Untitled'
            day = datetime.datetime.fromtimestamp(conv.get('create_time') or 0).strftime('%Y-%m-%d')
            name = re.sub(r'[\\/:*?"<>|#^\[\]]', ' ', f'{day} {title}').strip()[:120]
            path = os.path.join(out, name + '.md')
            if os.path.exists(path):
                path = os.path.join(out, f'{name} {(conv.get("conversation_id") or conv.get("id") or "")[:8]}.md')
                if os.path.exists(path):
                    continue
            parts = [f'---\ntitle: "{title.replace(chr(34), chr(39))}"\ndate: {day}\nconversation_id: "{conv.get("conversation_id") or conv.get("id")}"\nsource: chatgpt\n---\n']
            for t in turns:
                parts.append('## You\n\n' + clean(t['q']) + '\n\n## ChatGPT\n\n' + answer(t) + '\n')
            with open(path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(parts))
            n += 1
    print(f'{n} notes written to {out}')


if __name__ == '__main__':
    main()
