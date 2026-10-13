import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Library
from organizer import Organizer
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


if __name__ == '__main__': unittest.main()
