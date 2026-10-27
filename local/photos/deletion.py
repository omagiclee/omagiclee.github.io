"""Delete only explicitly selected, verified items through PhotoKit or macOS Trash."""
import datetime as dt
import hashlib
import json
import plistlib
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from organizer import image_signature


class Deletion:
    def __init__(self, library, native=None):
        self.library = library
        self.helper = Path(__file__).resolve().parents[2] / '.local-photos/native/LocalPhotos.app/Contents/MacOS/PhotoBridge'
        self.native = native or self.call_native
        with library.connect() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS deletions (id TEXT PRIMARY KEY, source TEXT, status TEXT, data TEXT)')

    def version(self, record):
        return hashlib.sha256(f"{self.library.source_key}:{record['id']}:{record['filename']}:{image_signature(record)}".encode()).hexdigest()

    def call_native(self, request):
        if not self.helper.is_file():
            raise ValueError('系统删除组件尚未安装，请先运行本地组件构建。')
        try:
            requests = self.helper.parents[3] / 'requests'
            requests.mkdir(exist_ok=True, mode=0o700)
            with tempfile.TemporaryDirectory(dir=requests) as directory:
                input_path, output_path = Path(directory) / 'request.json', Path(directory) / 'result.json'
                input_path.write_text(json.dumps(request)); input_path.chmod(0o600)
                subprocess.run(['/usr/bin/open', '-n', '-W', '-a', str(self.helper.parents[2]), '--args',
                                '--request', str(input_path), '--response', str(output_path)],
                               text=True, capture_output=True, timeout=180)
                response = output_path.read_text() if output_path.exists() else ''
        except subprocess.TimeoutExpired as error:
            raise ValueError('系统删除响应超时，请先在系统照片中检查结果，再刷新本页；不会自动重试。') from error
        try:
            result = json.loads(response)
        except ValueError as error:
            raise ValueError('系统删除组件未正常响应，未确认删除成功。') from error
        if not result.get('ok'):
            raise PermissionError(result.get('error', '系统没有完成删除。'))
        return result

    def system_library(self):
        home = Path.home()
        for path in [home / 'Library/Group Containers/group.com.apple.photolibraryd.private/Library/Preferences/group.com.apple.photolibraryd.private.plist',
                     home / 'Library/Containers/com.apple.photolibraryd/Data/Library/Preferences/com.apple.photolibraryd.plist']:
            try:
                value = plistlib.loads(path.read_bytes()).get('SystemLibraryPath')
                if isinstance(value, str): return Path(value).resolve()
            except (OSError, ValueError): pass
        # Read-only fallback also used by osxphotos when macOS omits the preference.
        import Photos
        if Photos.PHPhotoLibrary.respondsToSelector_(b'systemPhotoLibraryURL'):
            url = Photos.PHPhotoLibrary.systemPhotoLibraryURL()
            if url is not None:
                return Path(str(url.path())).resolve()
        raise ValueError('无法确认系统照片图库位置，暂不执行删除。')

    def photos_uuid(self, record):
        uuid = record.get('photos_uuid')
        if uuid:
            expected = hashlib.sha256(f"{self.library.source_key}\0{uuid}".encode()).hexdigest()[:32]
            if expected != record['id']: raise ValueError('照片标识与当前图库不匹配。')
            return uuid
        # Migrate older indexes by matching the original UUID hash, never by filename.
        database = Path(self.library.source['path']) / 'database/Photos.sqlite'
        connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        try:
            for (uuid,) in connection.execute('SELECT ZUUID FROM ZASSET WHERE ZUUID IS NOT NULL'):
                if hashlib.sha256(f"{self.library.source_key}\0{uuid}".encode()).hexdigest()[:32] == record['id']:
                    return uuid
        finally: connection.close()
        raise ValueError('无法匹配系统照片标识，请刷新图库。')

    def request_for(self, record):
        source = self.library.source
        root = Path(source['path']).expanduser().resolve()
        if source['kind'] == 'photos':
            if root != self.system_library():
                raise ValueError('当前不是系统照片图库，暂不执行删除。')
            return {'action': 'delete', 'uuid': self.photos_uuid(record), 'filename': record['filename']}
        path = Path(record.get('original_path') or '')
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('原文件不可用，暂不执行删除。')
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or any(parent.suffix == '.photoslibrary' for parent in [resolved, *resolved.parents]):
            raise ValueError('文件不在当前照片文件夹中。')
        stat = path.stat()
        return {'action': 'trash', 'path': str(resolved), 'size': stat.st_size, 'mtime': stat.st_mtime}

    def count(self):
        with self.library.connect() as connection:
            return connection.execute("SELECT count(*) FROM deletions WHERE source=? AND status='deleted'", (self.library.source_key,)).fetchone()[0]

    def delete_batch(self, items):
        if (not isinstance(items, list) or not 1 <= len(items) <= 500 or
                any(not isinstance(item, dict) or set(item) != {'id', 'version'} or
                    not isinstance(item['id'], str) or not item['id'] or
                    not isinstance(item['version'], str) for item in items)):
            raise ValueError('每次请选择 1 到 500 张照片，并提供当前版本。')
        ids = [item['id'] for item in items]
        if len(set(ids)) != len(ids):
            raise ValueError('照片列表中有重复项目。')
        if not self.library.lock.acquire(blocking=False):
            raise ValueError('图库正在处理另一个操作，请稍后重试。')
        try:
            if self.library.organizer.job_lock.locked():
                raise ValueError('请先停止正在运行的照片分析任务。')
            # Finish every source, version and path check before any native mutation.
            source = self.library.source_key
            records, requests = [], []
            for item in items:
                record = self.library.get(item['id'])
                if item['version'] != self.version(record):
                    raise ValueError('照片信息已变化，请刷新后再删除。')
                records.append(record)
                requests.append(dict(self.request_for(record), id=item['id']))
            destination = 'recently_deleted' if self.library.source['kind'] == 'photos' else 'trash'
            action = 'delete-batch' if destination == 'recently_deleted' else 'trash-batch'
            # Refuse aliases that could make a partial file result ambiguous.
            targets = [request['uuid'].upper() if destination == 'recently_deleted' else request['path'] for request in requests]
            if len(set(targets)) != len(targets):
                raise ValueError('照片列表指向了重复的原文件。')
            audits = {record['id']: {'filename': record['filename'], 'requested_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                                    'destination': destination} for record in records}
            with self.library.connect() as connection:
                connection.executemany('INSERT OR REPLACE INTO deletions VALUES (?,?,?,?)',
                                       [(identifier, source, 'pending', json.dumps(audits[identifier])) for identifier in ids])
            try:
                result = self.native({'action': action, 'items': requests})
                deleted, failed = result.get('deleted_ids'), result.get('failed')
                if (result.get('ok') is False or result.get('destination') != destination or not isinstance(deleted, list) or
                        any(not isinstance(identifier, str) for identifier in deleted) or
                        len(set(deleted)) != len(deleted) or not set(deleted).issubset(ids) or
                        not isinstance(failed, list) or
                        any(not isinstance(item, dict) or not isinstance(item.get('id'), str) or
                            not isinstance(item.get('error'), str) or not item['error'] for item in failed)):
                    raise ValueError('系统尚未确认删除结果，页面中的照片仍保留。')
                failed_ids = [item['id'] for item in failed]
                if (len(set(failed_ids)) != len(failed_ids) or set(deleted) & set(failed_ids) or
                        set(deleted) | set(failed_ids) != set(ids) or
                        (destination == 'recently_deleted' and set(deleted) != set(ids))):
                    raise ValueError('系统尚未确认全部删除结果，页面中的照片仍保留。')
            except Exception as error:
                with self.library.connect() as connection:
                    for identifier in ids:
                        audits[identifier]['error'] = str(error)
                        connection.execute("UPDATE deletions SET status='unconfirmed', data=? WHERE id=? AND source=?",
                                           (json.dumps(audits[identifier]), identifier, source))
                raise
            errors = {item['id']: item['error'] for item in failed}
            with self.library.connect() as connection:
                for identifier in ids:
                    if identifier in errors:
                        audits[identifier]['error'] = errors[identifier]
                    else:
                        connection.execute('DELETE FROM photos WHERE id=? AND source=?', (identifier, source))
                    connection.execute('UPDATE deletions SET status=?, data=? WHERE id=? AND source=?',
                                       ('unconfirmed' if identifier in errors else 'deleted', json.dumps(audits[identifier]), identifier, source))
            self.library.invalidate()
            self.library.organizer.vector_cache = None
            return {'deleted_ids': deleted, 'destination': destination, 'failed': failed}
        finally:
            self.library.lock.release()

    def delete(self, photo_id, version):
        if not self.library.lock.acquire(blocking=False):
            raise ValueError('图库正在处理另一个操作，请稍后重试。')
        try:
            if self.library.organizer.job_lock.locked():
                raise ValueError('请先停止正在运行的照片分析任务。')
            record = self.library.get(photo_id)
            if not isinstance(version, str) or version != self.version(record):
                raise ValueError('照片信息已变化，请刷新后再删除。')
            request = self.request_for(record)
            audit = {'filename': record['filename'], 'requested_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                     'destination': 'recently_deleted' if request['action'] == 'delete' else 'trash'}
            source = self.library.source_key
            with self.library.connect() as connection:
                connection.execute('INSERT OR REPLACE INTO deletions VALUES (?,?,?,?)', (photo_id, source, 'pending', json.dumps(audit)))
            try:
                result = self.native(request)
                if not result.get('deleted') or result.get('destination') != audit['destination']:
                    raise ValueError('系统尚未确认删除成功，页面中的照片仍保留。')
            except Exception:
                with self.library.connect() as connection:
                    connection.execute("UPDATE deletions SET status='unconfirmed' WHERE id=?", (photo_id,))
                raise
            with self.library.connect() as connection:
                connection.execute('DELETE FROM photos WHERE id=? AND source=?', (photo_id, source))
                connection.execute("UPDATE deletions SET status='deleted' WHERE id=?", (photo_id,))
            self.library.invalidate()
            self.library.organizer.vector_cache = None
            return {'deleted': True, 'destination': audit['destination']}
        finally:
            self.library.lock.release()
