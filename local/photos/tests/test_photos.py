import base64
import datetime as dt
import http.client
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR))
from app import Library, Server, local_file, safe_state
from journeys import coordinates, folder_location, create_journey, distance, export_story
from amap import load_amap_config
from footprints import build_footprints, city_info


def fixture(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for index in range(6):
        image = Image.new('RGB', (280 + index, 190), ('#789987', '#bf8864', '#678b9b')[index % 3])
        exif = Image.Exif()
        exif[306] = f'2024:05:{10 + index:02d} 12:00:00'
        exif[34853] = {1: 'N', 2: (31.0, 12.0 + index, 0.0), 3: 'E', 4: (121.0, 28.0, 0.0)}
        image.save(folder / f'moment-{index}.jpg', exif=exif)
    (folder / 'duplicate.jpg').write_bytes((folder / 'moment-0.jpg').read_bytes())
    (folder / 'ignored.txt').write_text('Not a photo')


def city_fixture(folder, state):
    fixture(folder)
    library = Library(state, {'kind': 'folder', 'path': str(folder)})
    library.scan()
    records = library.raw_photos()
    for photo in records:
        shanghai = photo['filename'] in {'moment-0.jpg', 'moment-1.jpg', 'duplicate.jpg'}
        photo.update(city='上海市' if shanghai else '杭州市', province='上海市' if shanghai else '浙江省',
                     country='中国', country_code='CN', place='上海市, 中国' if shanghai else '杭州市, 浙江省, 中国')
        if not shanghai:
            photo['location'] = {'lat': 30.2741, 'lon': 120.1551}
    with library.connect() as connection:
        connection.executemany('UPDATE photos SET data=? WHERE id=?', ((json.dumps(photo), photo['id']) for photo in records))
    library.preview_pool.shutdown(wait=True)


class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.folder = self.root / 'Trip'
        fixture(self.folder)
        self.library = Library(self.root / 'state', {'kind': 'folder', 'path': str(self.folder)})
        self.library.scan()
        self.assertEqual(self.library.status['phase'], 'ready')

    def tearDown(self):
        self.library.preview_pool.shutdown(wait=True)
        self.temporary.cleanup()

    def test_read_only_index_gps_and_annotation_persistence(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.folder.iterdir()}
        catalog = self.library.catalog({})
        self.assertEqual(catalog['count'], 7)
        photo = next(p for p in catalog['photos'] if p['filename'] == 'moment-0.jpg')
        self.assertAlmostEqual(photo['location']['lat'], 31.2)
        self.assertEqual(photo['date_source'], 'capture')
        updated = self.library.annotation(photo['id'], {'favorite': True, 'album': 'Travel', 'tags': ['family'], 'note': 'A sunny day'})
        self.assertTrue(updated['favorite'])
        self.library.scan()
        self.assertEqual(self.library.catalog({'q': 'sunny', 'view': 'favorites'})['count'], 1)
        self.assertEqual(self.library.catalog({'album': 'Travel'})['count'], 1)
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.folder.iterdir()}
        self.assertEqual(before, after)
        self.assertEqual(self.library.catalog({'month': '2024-05'})['count'], 7)
        self.assertEqual(self.library.catalog({'offset': '5', 'limit': '1'})['count'], 7)
        self.assertEqual(len(self.library.catalog({'offset': '5', 'limit': '1'})['photos']), 1)

    def test_exact_duplicates_and_missing_originals_are_excluded(self):
        self.library.duplicates()
        duplicates = self.library.catalog({'view': 'duplicates'})
        self.assertEqual(duplicates['count'], 2)
        self.assertEqual(len(set(p['duplicate'] for p in duplicates['photos'])), 1)
        self.assertEqual(self.library.status['duplicate_coverage'], 7)
        (self.folder / 'duplicate.jpg').unlink()
        self.library.scan()
        self.library.duplicates()
        self.assertEqual(self.library.catalog({'view': 'duplicates'})['count'], 0)

    def test_failed_scan_keeps_last_good_snapshot(self):
        with patch.object(self.library, 'scan_folder', side_effect=PermissionError('blocked')):
            self.library.scan()
        self.assertEqual(self.library.status['phase'], 'error')
        self.assertEqual(self.library.catalog({})['count'], 7)

    def test_preview_and_story_remove_private_metadata(self):
        photo = self.library.catalog({})['photos'][0]
        with Image.open(self.library.preview(photo['id'])) as image:
            self.assertFalse(image.getexif())
        entry = self.library.save_journey({'title': 'Travel <script>alert(1)</script>', 'start': '2024-05-10', 'end': '2024-05-15', 'intro': 'A happy trip'})
        detail = self.library.journey(entry['id'])
        self.assertEqual(detail['located'], 7)
        story = export_story(detail, self.library, {'limit': 24}).decode()
        self.assertNotIn('<script>', story)
        self.assertIn('&lt;script&gt;', story)
        self.assertNotIn(str(self.root), story)
        self.assertNotIn('moment-0.jpg', story)
        self.assertNotIn('31.2', story)
        self.assertNotIn('https://', story)
        for data in re.findall('data:image/jpeg;base64,([^\"]+)', story):
            with Image.open(io.BytesIO(base64.b64decode(data))) as image:
                self.assertFalse(image.getexif())
        shared = export_story(detail, self.library, {'limit': 24, 'include_locations': True}).decode()
        self.assertIn('保留到 0.1', shared)
        with self.assertRaises(ValueError):
            export_story(detail, self.library, {'include_locations': 'yes'})

    def test_coordinate_bounds_and_dataless_files(self):
        self.assertIsNone(coordinates(float('nan'), 120))
        self.assertIsNone(coordinates(91, 120))
        self.assertIsNone(coordinates(None, None))
        self.assertEqual(coordinates(0, 0), {'lat': 0.0, 'lon': 0.0})
        self.assertLess(distance({'lat': 0, 'lon': 179.9}, {'lat': 0, 'lon': -179.9}), 23)
        with patch('app.Path.stat', return_value=types.SimpleNamespace(st_size=100, st_flags=0x40000000)), patch('app.Path.is_file', return_value=True):
            self.assertIsNone(local_file('cloud-placeholder.jpg'))
        with self.assertRaises(ValueError):
            safe_state(APP_DIR.parents[1] / 'static' / 'photos')
        with self.assertRaises(ValueError):
            safe_state(self.root / 'Private.photoslibrary' / 'state')

    def test_photos_adapter_uses_local_derivatives_without_export(self):
        path = self.root / 'Test.photoslibrary'
        (path / 'database').mkdir(parents=True)
        (path / 'database' / 'Photos.sqlite').write_bytes(b'test sqlite header')
        preview = self.folder / 'moment-0.jpg'
        photo = types.SimpleNamespace(uuid='test-photo', hidden=False, intrash=False, path=None,
              path_edited=None, path_derivatives=[str(preview)], date=dt.datetime(2024, 5, 10),
              original_filename='cloud-original.heic', filename='cloud.heic', title='', description='',
              width=280, height=190, albums=['Trip'], keywords=[], favorite=False, incloud=True,
              latitude=31.2, longitude=121.4, place=None)
        hidden = types.SimpleNamespace(hidden=True, intrash=False)
        provider = types.SimpleNamespace(photos=lambda **kwargs: [photo, hidden])
        with patch.dict(sys.modules, {'osxphotos': types.SimpleNamespace(PhotosDB=lambda value: provider)}):
            records = list(self.library.scan_photos(path))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['availability'], 'preview')
        self.assertIsNone(records[0]['original_path'])
        self.assertEqual(records[0]['preview_source'], str(preview))

    def test_album_date_validation_and_unlocated_photos(self):
        with self.assertRaises(ValueError):
            create_journey({'title': 'Trip', 'start': '2024-05-15', 'end': '2024-05-10'}, self.library.snapshot())
        with self.assertRaises(ValueError):
            create_journey({'title': 'Trip', 'start': '2000-01-01', 'end': '2000-01-02'}, self.library.snapshot())
        entries = self.library.journeys()
        self.assertEqual(entries['located'], 7)
        self.assertTrue(entries['suggestions'])

    def test_amap_settings_are_literal_and_environment_overrides(self):
        config = self.root / '.env.amap.local'
        config.write_text('export HUGO_AMAP_WEB_KEY="fixture-key" # comment\nHUGO_AMAP_SECURITY_JSCODE=fixture-code\nOTHER=ignored\n')
        result = load_amap_config(config, {})
        self.assertTrue(result['enabled'])
        self.assertEqual(result['key'], 'fixture-key')
        self.assertEqual(load_amap_config(config, {'HUGO_AMAP_WEB_KEY': 'override'})['key'], 'override')
        config.write_text('HUGO_AMAP_WEB_KEY="$(do-not-execute)"\nHUGO_AMAP_SECURITY_JSCODE=fixture-code\n')
        self.assertEqual(load_amap_config(config, {})['key'], '$(do-not-execute)')
        self.assertFalse(load_amap_config(self.root / 'missing', {})['enabled'])

    def test_city_footprints_keep_unknown_locations_separate(self):
        city_fixture(self.folder, self.root / 'cities')
        cities = Library(self.root / 'cities')
        result = cities.footprints({})
        self.assertEqual(result['stats']['cities'], 2)
        self.assertEqual(result['stats']['countries'], 1)
        self.assertEqual(result['stats']['photos'], 7)
        shanghai = next(city for city in result['cities'] if city['name'] == '上海市')
        self.assertEqual(shanghai['photo_count'], 3)
        self.assertEqual(shanghai['days'], 2)
        self.assertEqual(cities.footprint_city(shanghai['id'], {'limit': '2'})['count'], 3)
        self.assertEqual(len(cities.footprint_city(shanghai['id'], {'limit': '2'})['photos']), 2)
        self.assertEqual(cities.footprints({'year': '2023'})['stats']['cities'], 0)
        album = cities.save_journey({'title': '上海回忆', 'start': '2024-05-10', 'end': '2024-05-15', 'city_id': shanghai['id']})
        self.assertEqual(len(cities.journey(album['id'])['photos']), 3)
        photos = list(cities.snapshot())
        photos[0] = {**photos[0], 'city': '', 'place': ''}
        photos[1] = {**photos[1], 'location': None}
        separated = build_footprints(photos)
        self.assertEqual(separated['stats']['unknown_city'], 1)
        self.assertEqual(separated['stats']['without_gps'], 1)
        self.assertIsNone(city_info({'location': {'lat': 30, 'lon': 120}, 'place': '浙江省, 中国'}))
        self.assertIsNotNone(city_info({'location': {'lat': 30, 'lon': 120}, 'place': '杭州市, 浙江省, 中国'}))
        with self.assertRaises(ValueError):
            cities.footprints({'year': 'not-a-year'})
        cities.preview_pool.shutdown(wait=True)


class HttpTests(unittest.TestCase):
    def setUp(self):
        PhotoTests.setUp(self)
        self.server = Server(('127.0.0.1', 0), self.library, map_config={})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        PhotoTests.tearDown(self)

    def request(self, path, method='GET', data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        body = json.dumps(data) if data is not None else None
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.headers), response.read()
        connection.close()
        return result

    def test_origin_host_csrf_and_traversal_boundaries(self):
        self.assertEqual(self.request('/api/photos', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/photos', headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.request('/api/scan', 'POST', {})[0], 403)
        self.assertEqual(self.request('/local-photos/%2e%2e/app.py')[0], 404)
        code, headers, body = self.request('/local-photos/')
        self.assertEqual(code, 200)
        self.assertIn("connect-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        code, headers, body = self.request('/api/photos')
        self.assertEqual(code, 200)
        self.assertNotIn(str(self.root).encode(), body.replace(json.dumps(self.library.source).encode(), b''))
        photo_id = self.library.snapshot()[0]['id']
        headers = {'Origin': self.server.origin, 'X-Photo-Token': self.server.token, 'Content-Type': 'application/json'}
        self.assertEqual(self.request(f'/api/annotations/{photo_id}', 'POST', {'favorite': True}, headers)[0], 200)
        headers['Origin'] = 'https://evil.example'
        self.assertEqual(self.request(f'/api/annotations/{photo_id}', 'POST', {'favorite': False}, headers)[0], 403)

    def test_amap_origin_only_referrer_and_config_boundaries(self):
        self.server.map_config = {'enabled': True, 'key': 'fixture-key', 'securityCode': 'fixture-code'}
        code, headers, body = self.request('/local-photos/')
        self.assertEqual(headers['Referrer-Policy'], 'strict-origin')
        self.assertIn('https://*.amap.com', headers['Content-Security-Policy'])
        self.assertNotIn(b'fixture-key', body)
        code, headers, body = self.request('/api/map-config')
        self.assertEqual(json.loads(body)['key'], 'fixture-key')
        self.assertEqual(self.request('/api/map-config', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/map-config', headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertNotIn(b'fixture-code', self.request('/api/export')[2])


if __name__ == '__main__':
    unittest.main()
