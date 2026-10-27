"""Import a reviewed batch produced by the conversation, without model/API calls."""
import argparse
import json
import sqlite3
from pathlib import Path
from app import Library


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--state', type=Path)
    parser.add_argument('--skip-stale', action='store_true', help='Skip photos deleted or changed while the batch was reviewed')
    args = parser.parse_args()
    manifest = json.loads((args.directory / 'manifest.json').read_text())
    index = {entry['label']: entry for entry in manifest}
    reviews = []
    for path in sorted(args.directory.glob('reviews-batch-*.json')):
        reviews.extend(json.loads(path.read_text()))
    if not reviews or len({review['label'] for review in reviews}) != len(reviews):
        raise ValueError('缺少结果或存在重复编号。')
    entries = [{**index[review['label']], **review} for review in reviews]
    library = Library(args.state) if args.state else Library()
    try:
        # Consistent backup before merging; original photos and human annotations remain untouched.
        backup = library.state / 'before-conversation-review.sqlite'
        if not backup.exists():
            with library.connect() as source, sqlite3.connect(backup) as target:
                source.backup(target)
            backup.chmod(0o600)
        count = library.content_reviews.save(entries, skip_stale=args.skip_stale)
        print(f'已导入 {count} 条对话看图建议，跳过 {len(entries) - count} 条已删除或变更项目；人工决定及原图未改动。')
    finally:
        library.preview_pool.shutdown(wait=True)


if __name__ == '__main__':
    main()
