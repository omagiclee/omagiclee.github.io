"""Local content organization, human cleanup review and versioned image vectors."""
from __future__ import annotations
import array
import hashlib
import json
import math
import os
from pathlib import Path
import select
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from taxonomy import TYPES, CATEGORIES, OCR_THEMES, REVISION, suggestion


def image_signature(record):
    value = record.get('preview_source')
    if not value:
        return None
    try:
        path = Path(value); stat = path.stat()
        if getattr(stat, 'st_flags', 0) & 0x40000000:
            return None
        return hashlib.sha256(f'{path}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    except OSError:
        return None


def ocr(path):
    import objc
    import Vision
    from Foundation import NSURL
    with objc.autorelease_pool():
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLanguages_(['zh-Hans', 'en-US'])
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setUsesLanguageCorrection_(True)
        handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(str(path)), {})
        ok, error = handler.performRequests_error_([request], None)
        if not ok:
            raise RuntimeError('本地 OCR 无法读取这张照片')
        return '\n'.join(str(item.topCandidates_(1)[0].string()) for item in (request.results() or [])
                         if item.topCandidates_(1)[0].confidence() >= .35)[:30000]


class ModelEngine:
    def __init__(self, state):
        self.state, self.process, self.info = state, None, None
        self.lock = threading.Lock()
        sibling = Path(__file__).resolve().parents[3] / 'data-flywheel'
        self.python = Path(os.getenv('LOCAL_PHOTOS_ML_PYTHON', str(sibling / '.venv-media/bin/python')))
        local_models = Path(__file__).resolve().parents[2] / '.local-photos/models'
        self.models = Path(os.getenv('LOCAL_PHOTOS_MODEL_ROOT', str(local_models if (local_models / 'manifest.json').exists() else sibling / '.data/models')))
        self.details_cache = None
        self.manifest_stamp = None

    def availability(self):
        try:
            manifest = self.models / 'manifest.json'
            stamp = manifest.stat().st_mtime_ns
            if self.details_cache and stamp == self.manifest_stamp:
                return self.details_cache
            entry = json.loads(manifest.read_text())['siglip2']
            directory = self.models / entry['path']
            config = json.loads((directory / 'config.json').read_text())
            size, dimensions = config['vision_config'].get('image_size', 224), config['text_config'].get('hidden_size', 768)
            available = self.python.is_file() and (directory / 'config.json').is_file() and bool(list(directory.glob('*.safetensors')))
            self.manifest_stamp = stamp
            self.details_cache = {'available': available, 'name': entry.get('repo_id', 'SigLIP2'), 'revision': entry['revision'], 'directory': directory,
                                  'dimensions': dimensions, 'model_key': f"siglip2@{entry['revision']}/rgb{size}-float32-l2-v1"}
            return self.details_cache
        except (OSError, ValueError, KeyError):
            return {'available': False, 'name': 'SigLIP2', 'issue': '本地图文模型尚未配置。'}

    def readline(self):
        if not select.select([self.process.stdout], [], [], 180)[0]:
            self.process.terminate(); self.process = None
            raise TimeoutError('本机模型处理超时')
        line = self.process.stdout.readline()
        if not line:
            self.process = None
            raise RuntimeError('本机模型进程已停止，请查看本地分析日志。')
        response = json.loads(line)
        if response.get('error'):
            raise RuntimeError(response['error'])
        return response

    def start(self):
        details = self.availability()
        if self.process and self.process.poll() is None:
            if self.info['model'] == details.get('model_key'): return
            self.process.terminate(); self.process.wait(); self.log.close()
        if not details['available']:
            raise RuntimeError(details.get('issue', '本地图文模型未就绪。'))
        self.log = (self.state / 'model.log').open('a')
        self.process = subprocess.Popen([str(self.python), str(Path(__file__).with_name('ml_worker.py')),
            '--model', str(details['directory']), '--revision', details['revision']],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, text=True, bufsize=1,
            env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'})
        self.info = self.readline()

    def call(self, operation, **values):
        with self.lock:
            self.start()
            self.process.stdin.write(json.dumps({'operation': operation, **values}) + '\n'); self.process.stdin.flush()
            return self.readline()


class Organizer:
    def __init__(self, library, engine=None, ocr_function=ocr):
        self.library = library
        self.engine = engine or ModelEngine(library.state)
        self.ocr = ocr_function
        self.cancel = threading.Event()
        self.job_lock = threading.Lock()
        self.cache_lock = threading.Lock()
        self.cache = None
        self.cache_source = None
        self.status = {'phase': 'idle', 'message': '尚未进行内容整理。', 'processed': 0, 'total': 0, 'errors': 0}
        self.vectors_lock = threading.Lock()
        self.vector_cache = None
        with library.connect() as connection:
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS analysis (id TEXT PRIMARY KEY, source TEXT, signature TEXT, recipe TEXT, data TEXT);
                CREATE INDEX IF NOT EXISTS analysis_source ON analysis(source);
                CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, model TEXT, dims INTEGER, value BLOB);
            ''')

    def records(self):
        with self.cache_lock:
            if self.cache is None or self.cache_source != self.library.source_key:
                with self.library.connect() as connection:
                    self.cache = {row[0]: {'signature': row[1], 'recipe': row[2], **json.loads(row[3])}
                                  for row in connection.execute('SELECT id,signature,recipe,data FROM analysis WHERE source=?', (self.library.source_key,))}
                self.cache_source = self.library.source_key
            return self.cache

    def public(self, record, annotation):
        analysis = self.records().get(record['id'])
        expected_model = self.engine.availability().get('model_key')
        vector_valid = analysis and analysis['signature'] == image_signature(record) and (not expected_model or analysis.get('model') == expected_model)
        valid = vector_valid and analysis.get('recipe') == REVISION
        category = annotation.get('category') or (analysis.get('category') if valid else None)
        media_type = annotation.get('media_type') or ('screenshot' if record.get('screenshot') else analysis.get('media_type') if valid else None)
        return {'analyzed': bool(valid), 'category': category, 'category_label': CATEGORIES.get(category, ('未整理', ''))[0],
                'media_type': media_type, 'media_type_label': TYPES.get(media_type, '未整理'),
                'review': annotation.get('review', 'unreviewed'), 'ocr_text': analysis.get('ocr_text', '') if valid else '',
                'analysis_method': analysis.get('method', '') if valid else '',
                'analysis_uncertain': analysis.get('uncertain', False) if valid else False,
                'analysis_tags': [value for value in [TYPES.get(media_type), CATEGORIES.get(category, ('', ''))[0]] if value],
                'has_embedding': bool(vector_valid and analysis.get('model')), 'model': analysis.get('model') if vector_valid else None,
                'classification_confirmed': bool(annotation.get('category') or annotation.get('media_type')),
                'custom_category': annotation.get('category', ''), 'custom_media_type': annotation.get('media_type', '')}

    def start(self, limit=None):
        if not self.job_lock.acquire(blocking=False):
            raise ValueError('内容整理任务已在运行。')
        self.cancel.clear()
        def task():
            try:
                self.run(limit)
            finally:
                self.job_lock.release()
        self.status = {'phase': 'running', 'message': '准备本地内容整理…', 'processed': 0, 'total': 0, 'errors': 0}
        threading.Thread(target=task, daemon=True).start()

    def run(self, limit=None):
        started = time.monotonic()
        try:
            records = self.library.raw_photos()
            source = self.library.source_key
            existing = self.records()
            expected_model = self.engine.availability().get('model_key')
            pending = [record for record in records if image_signature(record) and not (
                record['id'] in existing and existing[record['id']]['signature'] == image_signature(record)
                and existing[record['id']]['recipe'] == REVISION and (not expected_model or existing[record['id']].get('model') == expected_model))]
            pending.sort(key=lambda record: (bool(record.get('screenshot')), record.get('date', '')), reverse=True)
            if limit:
                pending = pending[:limit]
            self.status.update(total=len(pending), message='正在载入本机图文模型…')
            with ThreadPoolExecutor(max_workers=2) as pool:
                for start in range(0, len(pending), 2):
                    if self.cancel.is_set() or self.library.source_key != source:
                        self.status.update(phase='stopped', message='内容整理已停止，完成的结果已保留。'); break
                    batch = pending[start:start + 2]
                    paths, signatures = [], []
                    for record in batch:
                        paths.append(str(self.library.preview(record['id'], large=True))); signatures.append(image_signature(record))
                    output = self.engine.call('images', paths=paths)
                    if self.library.source_key != source:
                        self.status.update(phase='stopped', message='照片来源已切换，上一图库的已完成结果保留。'); return
                    if len(output['vectors']) != len(batch) or len(output['suggestions']) != len(batch):
                        raise RuntimeError('模型输出与照片数量不一致。')
                    ocr_jobs = []
                    for record, signature, visual, path in zip(batch, signatures, output['suggestions'], paths):
                        previous = existing.get(record['id'], {})
                        reuse = previous.get('signature') == signature and (previous.get('ocr_attempted') or previous.get('ocr_text')) and not previous.get('ocr_error')
                        if reuse:
                            from concurrent.futures import Future
                            job = Future(); job.set_result(previous.get('ocr_text', '')); ocr_jobs.append(job)
                        else:
                            ocr_jobs.append(pool.submit(self.ocr, path) if record.get('screenshot') or visual['category'] in OCR_THEMES else None)
                    for record, signature, vector, visual, job in zip(batch, signatures, output['vectors'], output['suggestions'], ocr_jobs):
                        text, error = '', False
                        if job:
                            try: text = job.result(timeout=60)
                            except Exception: error = True; self.status['errors'] += 1
                        values = array.array('f', vector)
                        dimensions = output.get('dimensions') or self.engine.availability().get('dimensions', 1152)
                        if len(values) != dimensions or not all(math.isfinite(value) for value in values) or abs(sum(value * value for value in values) - 1) > .01:
                            raise ValueError('图像向量维度或归一化无效。')
                        if image_signature(self.library.get(record['id'])) != signature:
                            self.status['errors'] += 1; continue
                        data = {**suggestion(record, visual, text), 'ocr_text': text, 'ocr_error': error, 'ocr_attempted': bool(job),
                                'model': output['model'], 'analyzed_at': time.time()}
                        with self.library.connect() as connection:
                            connection.execute('INSERT OR REPLACE INTO analysis VALUES (?,?,?,?,?)',
                                (record['id'], source, signature, REVISION, json.dumps(data, ensure_ascii=False)))
                            connection.execute('INSERT OR REPLACE INTO vectors VALUES (?,?,?,?)', (record['id'], output['model'], len(values), values.tobytes()))
                        with self.cache_lock:
                            if self.cache is not None: self.cache[record['id']] = {'signature': signature, 'recipe': REVISION, **data}
                        self.status['processed'] += 1
                    self.vector_cache = None
                    self.library.invalidate()
                    self.status.update(message=f"已整理 {self.status['processed']:,}/{len(pending):,} 张照片。分类建议请人工复核。",
                                       elapsed_seconds=round(time.monotonic() - started, 1))
                else:
                    self.status.update(phase='ready', message=f"本轮已整理 {self.status['processed']:,} 张照片，结果保存在本地。")
        except Exception as error:
            self.status.update(phase='error', message=f'内容整理未完成：{error}')

    def summary(self):
        photos = self.library.snapshot()
        categories, types, hierarchy, reviews = {}, {}, {}, {'unreviewed': 0, 'keep': 0, 'delete': 0}
        for photo in photos:
            if photo.get('category'): categories[photo['category']] = categories.get(photo['category'], 0) + 1
            if photo.get('media_type'): types[photo['media_type']] = types.get(photo['media_type'], 0) + 1
            if photo.get('media_type') and photo.get('category'):
                branch = hierarchy.setdefault(photo['media_type'], {})
                branch[photo['category']] = branch.get(photo['category'], 0) + 1
            reviews[photo.get('review', 'unreviewed')] += 1
        analyzed = sum(photo.get('analyzed', False) for photo in photos)
        status = dict(self.status)
        if status['phase'] == 'idle' and analyzed:
            status.update(phase='ready' if analyzed == len(photos) else 'idle', processed=analyzed, total=len(photos),
                          message=f'本地已有 {analyzed:,} 张照片的内容整理记录，可继续复核或查询。')
        return {'status': status, 'categories': categories, 'types': types, 'hierarchy': hierarchy, 'reviews': reviews,
                'taxonomy': {key: value[0] for key, value in CATEGORIES.items()}, 'type_labels': TYPES,
                'analyzed': analyzed,
                'embeddings': sum(photo.get('has_embedding', False) for photo in photos), 'total': len(photos),
                'model': {key: value for key, value in self.engine.availability().items() if key != 'directory'}}

    def search(self, query, photos):
        response = self.engine.call('text', query=query)
        query_vector = array.array('f', response['vectors'][0])
        dimensions = response.get('dimensions') or self.engine.availability().get('dimensions', 1152)
        if len(query_vector) != dimensions or not all(math.isfinite(value) for value in query_vector):
            raise ValueError('查询向量无效。')
        with self.vectors_lock:
            if self.vector_cache is None or self.vector_cache[0] != response['model']:
                with self.library.connect() as connection:
                    values = {row[0]: array.array('f', row[1]) for row in connection.execute('SELECT id,value FROM vectors WHERE model=? AND dims=?', (response['model'], dimensions))}
                self.vector_cache = (response['model'], values)
            values = self.vector_cache[1]
        results = []
        terms = [term.casefold() for term in query.split() if term.strip()]
        for photo in photos:
            if not photo.get('has_embedding') or photo.get('model') != response['model'] or photo['id'] not in values:
                continue
            vector = values[photo['id']]
            similarity = sum(a*b for a, b in zip(vector, query_vector))
            lexical = .08 if terms and all(term in photo.get('ocr_text', '').casefold() for term in terms) else 0
            results.append({**photo, 'search_similarity': similarity, 'search_score': similarity + lexical})
        return sorted(results, key=lambda photo: photo['search_score'], reverse=True)
