import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Library
from organizer import Organizer, image_signature
from taxonomy import suggestion
from test_photos import fixture


class FakeEngine:
    def __init__(self): self.model = 'fixture-model'; self.calls = 0
    def availability(self): return {'available': True, 'name': 'Test model', 'model_key': self.model, 'dimensions': getattr(self, 'dimensions', 1152)}
    def call(self, operation, **values):
        if operation == 'text':
            size = getattr(self, 'dimensions', 1152)
            return {'model': self.model, 'dimensions': size, 'vectors': [[1.0] + [0.0] * (size - 1)]}
        self.calls += 1
        size = getattr(self, 'dimensions', 1152)
        return {'model': self.model, 'dimensions': size, 'vectors': [[1.0] + [0.0] * (size - 1) for _ in values['paths']],
                'suggestions': [{'category': 'product', 'media_type': 'screenshot', 'margin': .02,
                                 'similarity': .2, 'alternatives': ['product', 'document', 'invoice']} for _ in values['paths']]}


class OrganizerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.folder = self.root / 'Photos'; fixture(self.folder)
        self.library = Library(self.root / 'state', {'kind': 'folder', 'path': str(self.folder)})
        self.library.scan(); self.engine = FakeEngine()
        self.library.organizer = Organizer(self.library, engine=self.engine, ocr_function=lambda path: '电子发票\n商品：蓝色背包\n价税合计 100 元')

    def tearDown(self):
        self.library.preview_pool.shutdown(wait=True); self.temp.cleanup()

    def test_ocr_classification_and_vectors_leave_originals_untouched(self):
        before = {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.folder.iterdir()}
        self.library.organizer.run()
        summary = self.library.organizer.summary()
        self.assertEqual(summary['analyzed'], 7); self.assertEqual(summary['embeddings'], 7)
        self.assertEqual(summary['categories']['invoice'], 7)
        self.assertEqual(self.library.catalog({'q': '蓝色背包'})['count'], 7)
        self.assertEqual(self.library.catalog({'media_type': 'screenshot', 'category': 'invoice'})['count'], 7)
        self.assertEqual(before, {path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.folder.iterdir()})
        calls = self.engine.calls; self.library.organizer.run(); self.assertEqual(self.engine.calls, calls)

    def test_review_and_human_corrections_survive_reanalysis(self):
        self.library.organizer.run(); photo = self.library.snapshot()[0]
        corrected = self.library.annotation(photo['id'], {'category': 'product', 'media_type': 'photo', 'review': 'delete'})
        self.assertEqual(corrected['category_label'], '商品／电商'); self.assertEqual(corrected['media_type'], 'photo')
        self.assertIn('商品／电商', corrected['tags']); self.assertNotIn('发票／票据', corrected['analysis_tags'])
        self.assertEqual(self.library.catalog({'review': 'delete'})['count'], 1)
        self.library.organizer.run()
        self.assertEqual(self.library.catalog({'review': 'delete'})['photos'][0]['category'], 'product')
        self.assertEqual(len(list(self.folder.glob('*.jpg'))), 7)
        with self.assertRaises(ValueError): self.library.annotation(photo['id'], {'review': 'erase-files'})

    def test_semantic_filters_and_model_version_are_enforced(self):
        self.library.organizer.run(); photo = self.library.snapshot()[0]
        self.library.annotation(photo['id'], {'category': 'product', 'review': 'keep'})
        results = self.library.catalog({'mode': 'semantic', 'q': '背包', 'category': 'product', 'review': 'keep'})
        self.assertEqual(results['count'], 1)
        self.engine.model = 'fixture-model-v2'; self.library.invalidate()
        self.assertEqual(self.library.organizer.summary()['embeddings'], 0)
        self.assertEqual(self.library.catalog({'mode': 'semantic', 'q': '背包'})['count'], 0)
        self.library.organizer.run(); self.assertEqual(self.library.organizer.summary()['embeddings'], 7)

    def test_vectors_do_not_enter_offline_story(self):
        self.library.organizer.run()
        entry = self.library.save_journey({'title': 'Trip', 'start': '2024-05-10', 'end': '2024-05-15'})
        from journeys import export_story
        body = export_story(self.library.journey(entry['id']), self.library, {}).decode()
        self.assertNotIn('电子发票', body); self.assertNotIn('fixture-model', body)

    def test_invoice_word_alone_does_not_override_product_page(self):
        visual = {'category': 'product', 'media_type': 'screenshot', 'margin': .1}
        self.assertEqual(suggestion({}, visual, '商品详情\n加入购物车\n可开发票')['category'], 'product')
        self.assertEqual(suggestion({}, visual, '电子发票\n价税合计\n纳税人识别号')['category'], 'invoice')

    def test_lightweight_model_dimensions_and_ocr_reuse(self):
        self.library.organizer.run()
        self.engine.model = 'fixture-light-model'; self.engine.dimensions = 768
        self.library.organizer.ocr = lambda path: (_ for _ in ()).throw(AssertionError('OCR must be reused'))
        self.library.organizer.run()
        self.assertEqual(self.library.organizer.status['errors'], 0)
        self.assertEqual(self.library.organizer.summary()['embeddings'], 7)
        self.assertEqual(self.library.catalog({'mode': 'semantic', 'q': '蓝色背包'})['count'], 7)

    def test_conversation_review_is_not_a_human_decision_and_detects_changed_images(self):
        photo = self.library.raw_photos()[0]
        before = Path(photo['preview_source']).read_bytes()
        entry = {'id': photo['id'], 'source': self.library.source_key, 'signature': image_signature(photo),
                 'label': 'SCR001', 'description': '蓝色背包商品详情截图', 'recommendation': 'candidate',
                 'reason': '可能是临时购物参考', 'caution': '无法确认是否仍有购买用途', 'tags': ['背包', '购物参考']}
        self.library.annotation(photo['id'], {'review': 'keep', 'note': '人工保留'})
        live_reader = Library(self.root / 'state', self.library.source)
        self.assertEqual(live_reader.catalog({'ai_review': 'all'})['count'], 0)
        self.library.content_reviews.save([entry])
        self.assertEqual(live_reader.catalog({'ai_review': 'all'})['count'], 1)
        live_reader.preview_pool.shutdown(wait=True)
        result = self.library.catalog({'ai_review': 'candidate', 'q': '背包'})
        self.assertEqual(result['count'], 1)
        reviewed = result['photos'][0]
        self.assertEqual(reviewed['review'], 'keep')
        self.assertEqual(reviewed['note'], '人工保留')
        self.assertFalse(reviewed['classification_confirmed'])
        self.assertEqual(self.library.organizer.summary()['content_reviews']['candidate'], 1)
        self.assertEqual(self.library.organizer.summary()['content_review_pending']['candidate'], 0)
        self.assertEqual(self.library.organizer.summary()['content_review_decisions']['keep'], 1)
        self.assertNotIn('signature', reviewed['content_review'])
        self.assertNotIn('source', reviewed['content_review'])
        self.assertEqual(Path(photo['preview_source']).read_bytes(), before)
        restarted = Library(self.root / 'state', self.library.source)
        self.assertEqual(restarted.catalog({'ai_review': 'all'})['count'], 1)
        restarted.preview_pool.shutdown(wait=True)
        with self.assertRaises(ValueError):
            self.library.content_reviews.save([{**entry, 'source': 'wrong-source'}])
        Path(photo['preview_source']).write_bytes(before + b'changed')
        self.library.invalidate()
        self.assertEqual(self.library.catalog({'ai_review': 'all'})['count'], 0)

    def test_precise_review_requires_inspection_and_can_skip_deleted_items(self):
        photo = self.library.raw_photos()[0]
        entry = {'id': photo['id'], 'source': self.library.source_key, 'signature': image_signature(photo),
                 'label': 'SCR001', 'description': '商品详情页显示蓝色背包和尺寸选项。', 'recommendation': 'uncertain',
                 'reason': '是否仍需选购由用户判断', 'caution': '品牌文字不清', 'tags': ['背包', '商品详情', '尺寸'],
                 'review_standard': 'grounded-v2', 'category': 'product'}
        with self.assertRaises(ValueError): self.library.content_reviews.save([entry])
        entry['inspection'] = {'full_image': True, 'zoomed': True, 'unclear_fields': ['品牌']}
        self.assertEqual(self.library.content_reviews.save([entry]), 1)
        saved = self.library.catalog({'ai_review': 'all'})['photos'][0]['content_review']
        self.assertEqual(saved['review_standard'], 'grounded-v2')
        self.assertEqual(saved['inspection']['unclear_fields'], ['品牌'])
        displayed = self.library.catalog({'ai_review': 'all'})['photos'][0]
        self.assertEqual(displayed['category'], 'product')
        self.assertIn('背包', displayed['tags'])
        corrected = self.library.annotation(photo['id'], {'category': 'invoice'})
        self.assertEqual(corrected['category'], 'invoice')
        with self.library.connect() as connection:
            connection.execute('DELETE FROM photos WHERE id=?', (photo['id'],))
        self.assertEqual(self.library.content_reviews.save([entry], skip_stale=True), 0)

    def test_cleanup_presentation_is_versioned_and_does_not_replace_human_category(self):
        photo = self.library.raw_photos()[0]
        entry = {'id': photo['id'], 'source': self.library.source_key, 'signature': image_signature(photo),
                 'label': 'SCR001', 'description': '背包商品页。', 'recommendation': 'candidate',
                 'reason': '购物参考', 'caution': '', 'tags': ['背包', '商品', '规格'],
                 'category': 'product', 'short_description': '蓝色背包', 'cleanup_group': 'A'}
        self.library.content_reviews.save([entry])
        self.library.annotation(photo['id'], {'category': 'invoice', 'review': 'keep'})
        without_display = {k: v for k, v in entry.items() if k not in ('short_description', 'cleanup_group')}
        self.library.content_reviews.save([without_display])
        public = self.library.catalog({'ai_review': 'all'})['photos'][0]
        self.assertEqual(public['content_review']['short_description'], '蓝色背包')
        self.assertEqual(public['category'], 'invoice')
        self.assertEqual(public['review'], 'keep')
        self.library.content_reviews.save([{**without_display, 'description': '修正后的商品内容。'}])
        self.assertNotIn('short_description', self.library.content_reviews.public(photo))
        with self.assertRaises(ValueError):
            self.library.content_reviews.save([{**entry, 'cleanup_group': 'unknown'}])


if __name__ == '__main__': unittest.main()
