"""Import actual conversation vision reviews; never infer or execute deletion."""
import datetime as dt
import json
import threading
from organizer import image_signature
from taxonomy import CATEGORIES


class ContentReviews:
    def __init__(self, library):
        self.library, self.cache, self.source = library, None, None
        self.database_stamp = None
        self.lock = threading.Lock()
        with library.connect() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS content_reviews (id TEXT PRIMARY KEY, source TEXT, signature TEXT, data TEXT)')

    def changed(self):
        """Notice background imports without interrupting the running web server."""
        stamps = []
        for path in (self.library.database, self.library.database.with_name(self.library.database.name + '-wal')):
            try:
                stat = path.stat(); stamps.append((stat.st_mtime_ns, stat.st_size))
            except FileNotFoundError:
                stamps.append(None)
        stamp = tuple(stamps)
        with self.lock:
            if stamp == self.database_stamp: return False
            self.database_stamp, self.cache = stamp, None
            return True

    def records(self):
        with self.lock:
            if self.cache is None or self.source != self.library.source_key:
                self.source = self.library.source_key
                with self.library.connect() as connection:
                    self.cache = {row[0]: (row[1], json.loads(row[2])) for row in connection.execute(
                        'SELECT id,signature,data FROM content_reviews WHERE source=?', (self.source,))}
            return self.cache

    def public(self, record):
        result = self.records().get(record['id'])
        return result[1] if result and result[0] == image_signature(record) else None

    def save(self, entries, skip_stale=False):
        prepared = []
        for entry in entries:
            try:
                record = self.library.get(entry['id'])
            except FileNotFoundError:
                if skip_stale: continue
                raise
            if entry.get('source') != self.library.source_key or entry.get('signature') != image_signature(record):
                if skip_stale: continue
                raise ValueError('看图结果与当前照片来源或文件版本不一致。')
            data = {}
            for key, maximum in [('description', 1000), ('reason', 1000), ('caution', 1000), ('label', 80)]:
                value = entry.get(key)
                if not isinstance(value, str) or (key != 'caution' and not value.strip()) or len(value) > maximum:
                    raise ValueError('看图说明无效。')
                data[key] = value
            if entry.get('recommendation') not in {'candidate', 'keep', 'uncertain'}:
                raise ValueError('看图建议无效。')
            tags = entry.get('tags', [])
            if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(tag, str) or len(tag) > 80 for tag in tags):
                raise ValueError('看图标签无效。')
            standard = entry.get('review_standard', 'legacy-v1')
            if standard not in {'legacy-v1', 'grounded-v2'}:
                raise ValueError('看图标准无效。')
            data['review_standard'] = standard
            if 'category' in entry:
                if entry['category'] not in CATEGORIES: raise ValueError('看图内容分类无效。')
                data['category'] = entry['category']
            previous = self.public(record) or {}
            same_caption = (previous.get('description') == data['description'] and
                            previous.get('category') == data.get('category'))
            for field in ('short_description', 'cleanup_group'):
                value = entry.get(field, previous.get(field) if same_caption else None)
                if value is None:
                    continue
                if (not isinstance(value, str) or not value.strip() or
                        (field == 'short_description' and len(value) > 160) or
                        (field == 'cleanup_group' and value not in tuple('ABCDEFGHIJKLMNOPQR'))):
                    raise ValueError('清理清单的分组或简短说明无效。')
                data[field] = value
            if standard == 'grounded-v2':
                if not 3 <= len(tags) <= 8 or len(set(tag.strip() for tag in tags)) != len(tags) or any(not tag.strip() for tag in tags):
                    raise ValueError('新版标签应为 3 到 8 个不重复的具体检索词。')
                inspection = entry.get('inspection', {})
                if not isinstance(inspection, dict) or inspection.get('full_image') is not True or not isinstance(inspection.get('zoomed'), bool):
                    raise ValueError('新版看图结果必须记录单图复核及放大检查情况。')
                unclear = inspection.get('unclear_fields', [])
                if not isinstance(unclear, list) or len(unclear) > 12 or any(not isinstance(value, str) or len(value) > 120 for value in unclear):
                    raise ValueError('不确定内容记录无效。')
                data['inspection'] = {'full_image': True, 'zoomed': inspection['zoomed'], 'unclear_fields': unclear}
            data.update(recommendation=entry['recommendation'], tags=tags, provider='conversation',
                        requested_model='gpt-6.1-sol', model_label='对话看图 · GPT‑6.1 Sol（用户指定）',
                        analyzed_at=dt.datetime.now(dt.timezone.utc).isoformat())
            prepared.append((entry['id'], self.library.source_key, entry['signature'], json.dumps(data, ensure_ascii=False)))
        with self.library.connect() as connection:
            before = connection.total_changes
            connection.executemany('INSERT OR REPLACE INTO content_reviews SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM photos WHERE id=? AND source=?)',
                                   [(*entry, entry[0], entry[1]) for entry in prepared])
            written = connection.total_changes - before
        with self.lock:
            self.cache = None
        self.library.save_setting('content_reviews_revision', dt.datetime.now(dt.timezone.utc).isoformat())
        self.library.invalidate()
        return written
