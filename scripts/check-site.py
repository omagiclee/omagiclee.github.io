#!/usr/bin/env python3
"""Validate the built site, including publication rules Hugo itself does not flag."""
import argparse
import datetime as dt
import gzip
import json
import sys
import tomllib
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]

class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.references, self.ids, self.scripts = [], set(), []
        self.structured_data, self.json_buffer = [], None
        self.language = None
        self.mermaid = self.pseudocode = False
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'html':
            self.language = attrs.get('lang')
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.json_buffer = []
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        classes = (attrs.get('class') or '').split()
        self.mermaid |= 'mermaid' in classes
        self.pseudocode |= 'pseudocode' in classes
        if tag == 'script' and attrs.get('src'):
            self.scripts.append(attrs['src'])
        for key in {'a': ['href'], 'img': ['src', 'data-src'], 'script': ['src'],
                    'link': ['href'], 'source': ['src'], 'video': ['src', 'poster'],
                    'audio': ['src'], 'iframe': ['src']}.get(tag, []):
            if key in attrs:
                self.references.append((tag, attrs[key] or ""))

    def handle_data(self, data):
        if self.json_buffer is not None:
            self.json_buffer.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.json_buffer is not None:
            self.structured_data.append(''.join(self.json_buffer))
            self.json_buffer = None


def frontmatter(path):
    text = path.read_text(encoding='utf-8')
    if not text.startswith('+++'):
        return None
    return tomllib.loads(text.split('+++', 2)[1])


def future(value, now):
    if not value:
        return False
    if isinstance(value, str):
        value = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        value = dt.datetime.combine(value, dt.time())
    return value.replace(tzinfo=value.tzinfo or dt.timezone.utc) > now


def content_url(path, meta):
    if meta.get('url'):
        return meta['url']
    relative = path.relative_to(ROOT / 'content')
    parts = list(relative.parts[:-1])
    if path.stem not in ('index', '_index'):
        parts.append(path.stem)
    if meta.get('slug') and parts:
        parts[-1] = meta['slug']
    return '/' + '/'.join(parts).lower().replace(' ', '-') + '/'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('public', type=Path, nargs='?', default=ROOT / 'public')
    args = parser.parse_args()
    public = args.public.resolve()
    config = tomllib.loads((ROOT / 'hugo.toml').read_text())
    origin = config['baseURL']
    host = urlsplit(origin).netloc
    errors = []

    def output(url):
        path = public / unquote(urlsplit(url).path).lstrip('/')
        if path.is_dir() or urlsplit(url).path.endswith('/'):
            path = path / 'index.html'
        return path

    documents = {}
    for path in public.rglob('*.html'):
        documents[path] = Document(path.read_text(encoding='utf-8'))
    if not documents:
        errors.append('No HTML output found; run a production Hugo build first.')

    for path, doc in documents.items():
        page_url = urljoin(origin, path.relative_to(public).as_posix())
        for tag, reference in doc.references:
            if not reference.strip():
                errors.append(f'{path.relative_to(public)}: empty {tag} URL')
                continue
            target = urlsplit(urljoin(page_url, reference))
            if target.scheme not in ('http', 'https') or target.netloc != host:
                continue
            destination = output(target.geturl())
            if not destination.is_file():
                errors.append(f'{path.relative_to(public)}: missing {reference}')
            elif tag == 'a' and target.fragment and destination in documents:
                if unquote(target.fragment) not in documents[destination].ids:
                    errors.append(f'{path.relative_to(public)}: missing anchor {reference}')
        if doc.mermaid and not any('/mermaid/' in src for src in doc.scripts):
            errors.append(f'{path.relative_to(public)}: Mermaid markup without its script')
        if doc.pseudocode and not any('pseudocode' in src for src in doc.scripts):
            errors.append(f'{path.relative_to(public)}: pseudocode markup without its script')
        if any('/css/custom.css' in ref for _, ref in doc.references):
            errors.append(f'{path.relative_to(public)}: obsolete standalone custom.css')
        for raw in doc.structured_data:
            try:
                data = json.loads(raw)
                if data.get('@type') == 'BlogPosting':
                    if not data.get('publisher', {}).get('name'):
                        errors.append(f'{path.relative_to(public)}: JSON-LD publisher is empty')
                    if not data.get('description'):
                        errors.append(f'{path.relative_to(public)}: JSON-LD description is empty')
                    if data.get('inLanguage') != doc.language:
                        errors.append(f'{path.relative_to(public)}: conflicting content languages')
            except (json.JSONDecodeError, AttributeError):
                errors.append(f'{path.relative_to(public)}: invalid JSON-LD')

    now = dt.datetime.now(dt.timezone.utc)
    published = 0
    for path in (ROOT / 'content').rglob('*.md'):
        meta = frontmatter(path)
        if meta is None:
            continue
        # Non-index Markdown inside a leaf bundle may intentionally be a resource.
        if path.stem not in ('index', '_index') and (path.parent / 'index.md').exists():
            continue
        route = content_url(path, meta)
        build = meta.get('build', meta.get('_build', {}))
        excluded_draft = meta.get('draft') and not config.get('buildDrafts', False)
        excluded_future = future(meta.get('publishDate', meta.get('date')), now) and not config.get('buildFuture', False)
        if excluded_draft or excluded_future:
            if output(route).is_file():
                errors.append(f'{path.relative_to(ROOT)}: excluded draft/future page was published at {route}')
            continue
        if meta.get('headless') or build.get('render') in ('never', False):
            continue
        published += 1
        if not output(route).is_file():
            errors.append(f'{path.relative_to(ROOT)}: published source has no page at {route} (check leaf bundles)')
        for alias in meta.get('aliases', []):
            if not output(urljoin(route, alias)).is_file():
                errors.append(f'{path.relative_to(ROOT)}: alias missing: {alias}')

    legacy_file = ROOT / 'scripts/legacy-urls.json'
    legacy = json.loads(legacy_file.read_text()) if legacy_file.exists() else {}
    for old, new in legacy.items():
        old_page = output(old)
        if not old_page.is_file() or not output(new).is_file():
            errors.append(f'Legacy redirect missing: {old} -> {new}')
        elif urljoin(origin, new) not in old_page.read_text():
            errors.append(f'Legacy redirect has wrong target: {old} -> {new}')

    for path in public.rglob('*'):
        if path.is_file() and (path.suffix in ('.bak', '.backup') or path.name == 'bak.md'):
            errors.append(f'Backup file published: {path.relative_to(public)}')
    search_path = public / 'index.json'
    if search_path.exists():
        search = json.loads(search_path.read_text())
        for item in search:
            if not output(item['uri']).is_file():
                errors.append(f'Search points to missing page: {item["uri"]}')
        if any('/posts/work/job-interview/' == item['uri'] for item in search):
            errors.append('Private interview draft leaked into search')

    for path in public.rglob('index.xml'):
        tree = ET.parse(path)
        if tree.getroot().tag != 'rss':
            continue
        feed = tree.find('channel/{http://www.w3.org/2005/Atom}link')
        expected = urljoin(origin, path.relative_to(public).as_posix())
        if feed is not None and unquote(feed.get('href', '')) != unquote(expected):
            errors.append(f'{path.relative_to(public)}: incorrect RSS self URL')
        if tree.findtext('channel/language') != config['params']['contentLanguage']:
            errors.append(f'{path.relative_to(public)}: incorrect RSS language')

    for path in (public / 'css').glob('style*.css'):
        if len(gzip.compress(path.read_bytes())) > 22000:
            errors.append(f'{path.name}: gzip CSS exceeds 22 KB budget')

    if errors:
        print('\n'.join(sorted(set(errors))), file=sys.stderr)
        print(f'FAILED: {len(set(errors))} site validation errors', file=sys.stderr)
        return 1
    print(f'Validated {len(documents)} HTML pages, {published} published sources and {len(legacy)} legacy redirects.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
