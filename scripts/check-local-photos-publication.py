#!/usr/bin/env python3
"""Fail if local photo routes or runtime data enter a production artifact."""
import sys
from pathlib import Path

public = Path(sys.argv[1] if len(sys.argv) > 1 else 'public')
failures = []
for candidate in public.rglob('*'):
    relative = candidate.relative_to(public)
    if any(part in {'.local-photos', 'local-photos', 'photoslibrary', 'local/photos'} for part in relative.parts):
        failures.append(str(relative))
    if candidate.is_file() and candidate.suffix in {'.html', '.xml', '.json'}:
        content = candidate.read_text(errors='replace')
        if any(marker in content for marker in ('href="/local-photos/', 'href=/local-photos/', '/api/preview/', '/api/footprints', 'catalog.sqlite', 'Only on this Mac', '仅在本机浏览')):
            failures.append(str(relative))
if failures:
    raise SystemExit('Local photo content found in production: ' + ', '.join(failures[:10]))
print('Production boundary verified: no local photo entry, API links, indexes or previews.')
