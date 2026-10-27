import json
import hashlib
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import Library
from test_photos import fixture

class DeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.folder=self.root/'Photos';fixture(self.folder)
        self.library=Library(self.root/'state',{'kind':'folder','path':str(self.folder)})
        self.library.scan();self.photo=self.library.snapshot()[0]
        self.calls=[]
    def tearDown(self):
        self.library.preview_pool.shutdown(wait=True);self.temp.cleanup()
    def fake_native(self,request):
        self.calls.append(request)
        target=self.root/'Trash';target.mkdir(exist_ok=True)
        Path(request['path']).rename(target/Path(request['path']).name)
        return {'ok':True,'deleted':True,'destination':'trash'}
    def test_success_removes_only_selected_photo_after_native_delete(self):
        self.library.deletion.native=self.fake_native
        self.library.annotation(self.photo['id'],{'review':'keep'})
        result=self.library.deletion.delete(self.photo['id'],self.photo['deletion_version'])
        self.assertTrue(result['deleted']);self.assertEqual(len(self.calls),1)
        self.assertEqual(len(self.library.snapshot()),6);self.assertEqual(self.library.deletion.count(),1)
        self.assertTrue((self.root/'Trash'/self.photo['filename']).is_file())
        self.assertEqual(len(list(self.folder.glob('*.jpg'))),6)
        with self.assertRaises(FileNotFoundError):self.library.get(self.photo['id'])
    def test_stale_request_and_native_failure_keep_photo_visible(self):
        self.library.deletion.native=self.fake_native
        with self.assertRaises(ValueError):self.library.deletion.delete(self.photo['id'],'stale')
        self.assertEqual(self.calls,[])
        self.library.deletion.native=lambda request: {'ok':True,'deleted':False}
        with self.assertRaises(ValueError):self.library.deletion.delete(self.photo['id'],self.photo['deletion_version'])
        self.assertEqual(len(self.library.snapshot()),7);self.assertEqual(self.library.deletion.count(),0)
        self.assertTrue((self.folder/self.photo['filename']).is_file())
    def test_native_cancel_and_outside_folder_are_not_deleted(self):
        def cancel(request):raise PermissionError('用户取消了系统操作')
        self.library.deletion.native=cancel
        with self.assertRaises(PermissionError):self.library.deletion.delete(self.photo['id'],self.photo['deletion_version'])
        self.assertEqual(len(self.library.snapshot()),7)
        record=self.library.get(self.photo['id']);record['original_path']=str(self.root/'outside.jpg')
        (self.root/'outside.jpg').write_bytes(b'outside')
        with self.assertRaises(ValueError):self.library.deletion.request_for(record)
    def test_system_library_must_match(self):
        self.library.source={'kind':'photos','path':str(self.root/'Configured.photoslibrary')}
        with patch.object(self.library.deletion,'system_library',return_value=self.root/'Other.photoslibrary'):
            with self.assertRaises(ValueError):self.library.deletion.request_for({'id':'anything','filename':'x.jpg'})

    def items(self):
        return [{'id': photo['id'], 'version': photo['deletion_version']} for photo in self.library.snapshot()[:3]]

    def test_batch_single_native_call_and_partial_folder_failure(self):
        items = self.items()
        self.library.organizer.vector_cache = object()
        def native(request):
            self.calls.append(request)
            self.assertEqual(request['action'], 'trash-batch')
            self.assertEqual([item['id'] for item in request['items']], [item['id'] for item in items])
            return {'deleted_ids': [items[0]['id'], items[2]['id']], 'destination': 'trash',
                    'failed': [{'id': items[1]['id'], 'error': '文件被锁定'}]}
        self.library.deletion.native = native
        result = self.library.deletion.delete_batch(items)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['failed'][0]['id'], items[1]['id'])
        self.assertEqual(len(self.library.snapshot()), 5)
        self.assertEqual(self.library.deletion.count(), 2)
        self.assertIsNone(self.library.organizer.vector_cache)
        self.library.get(items[1]['id'])
        with self.library.connect() as connection:
            rows = connection.execute('SELECT id,status,data FROM deletions').fetchall()
        self.assertEqual(len(rows), 3)
        self.assertEqual(json.loads(next(row[2] for row in rows if row[0] == items[1]['id']))['error'], '文件被锁定')

    def test_batch_prevalidates_all_items_before_native(self):
        items = self.items()
        invalid = [[], items * 200, [items[0], items[0]], [items[0], {**items[1], 'version': 'stale'}],
                   [items[0], {'id': 'other-library', 'version': 'anything'}], [dict(items[0], extra=True)]]
        with patch.object(self.library.deletion, 'native') as native:
            for selection in invalid:
                with self.subTest(selection=selection[:2]):
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        self.library.deletion.delete_batch(selection)
            native.assert_not_called()
        self.assertEqual(self.library.deletion.count(), 0)
        self.assertEqual(len(self.library.snapshot()), 7)

    def test_batch_cancel_and_untrusted_result_keep_index(self):
        items = self.items()
        with patch.object(self.library.deletion, 'native', side_effect=PermissionError('用户取消')) as native:
            with self.assertRaises(PermissionError): self.library.deletion.delete_batch(items)
            native.assert_called_once()
        for deleted, failed in [(['unselected'], []), ([items[0]['id']] * 2, []),
                                ([items[0]['id']], []), ([], [{'id': item['id'], 'error': ''} for item in items])]:
            with patch.object(self.library.deletion, 'native', return_value={'deleted_ids': deleted, 'failed': failed, 'destination': 'trash'}):
                with self.assertRaises(ValueError): self.library.deletion.delete_batch(items)
        self.assertEqual(len(self.library.snapshot()), 7)
        with self.library.connect() as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM deletions WHERE status='unconfirmed'").fetchone()[0], 3)

    def test_photos_batch_uses_one_verified_native_request(self):
        self.library.source = {'kind': 'photos', 'path': str(self.root/'Synthetic.photoslibrary')}
        source = self.library.source_key
        records = []
        for index in range(3):
            uuid = f'00000000-0000-0000-0000-{index:012d}'
            records.append({'id': hashlib.sha256(f'{source}\0{uuid}'.encode()).hexdigest()[:32],
                            'photos_uuid': uuid, 'filename': f'{index}.jpg'})
        items = [{'id': record['id'], 'version': self.library.deletion.version(record)} for record in records]
        def native(request):
            self.calls.append(request)
            self.assertEqual(request['action'], 'delete-batch')
            self.assertEqual([item['uuid'] for item in request['items']], [record['photos_uuid'] for record in records])
            return {'ok': True, 'deleted_ids': [item['id'] for item in items], 'destination': 'recently_deleted', 'failed': []}
        with patch.object(self.library, 'get', side_effect=lambda identifier: next(record for record in records if record['id'] == identifier)), \
             patch.object(self.library.deletion, 'system_library', return_value=Path(self.library.source['path']).resolve()):
            with patch.object(self.library.deletion, 'native', side_effect=PermissionError('用户取消')):
                with self.assertRaises(PermissionError): self.library.deletion.delete_batch(items)
                self.assertEqual(self.library.deletion.count(), 0)
            with patch.object(self.library.deletion, 'native', return_value={
                    'deleted_ids': [items[0]['id']], 'destination': 'recently_deleted',
                    'failed': [{'id': item['id'], 'error': '未完成'} for item in items[1:]]}):
                with self.assertRaises(ValueError): self.library.deletion.delete_batch(items)
                self.assertEqual(self.library.deletion.count(), 0)
            self.library.deletion.native = native
            self.assertEqual(self.library.deletion.delete_batch(items)['deleted_ids'], [item['id'] for item in items])
            self.assertEqual(len(self.calls), 1)
            self.calls.clear()
            records[2]['photos_uuid'] = '00000000-0000-0000-0000-000000000099'
            with self.assertRaises(ValueError): self.library.deletion.delete_batch(items)
            self.assertEqual(self.calls, [])

if __name__=='__main__':unittest.main()
