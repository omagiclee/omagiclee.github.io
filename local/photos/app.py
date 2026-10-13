#!/usr/bin/env python3
"""Read-only photo indexing and a loopback-only viewer. No cloud/export APIs."""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import mimetypes
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from journeys import coordinates, folder_location, journey_detail, journey_lists, create_journey, export_story
from amap import load_amap_config
from footprints import build_footprints
from organizer import Organizer
from taxonomy import TYPES, CATEGORIES

ROOT = Path(__file__).resolve().parents[2]
UI = Path(__file__).resolve().parent / "ui"
STATE = ROOT / ".local-photos" / "state"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff", ".gif", ".bmp"}
PERMISSION_MESSAGE = (
    "macOS 暂不允许读取照片图库。请在系统设置 → 隐私与安全性 → 完全磁盘访问权限中，"
    "启用运行工具的 Codex 或终端，重启该应用后刷新相册。也可以选择已导出的本地照片文件夹。"
)


def local_file(value):
    """Do not open dataless iCloud placeholders, even to hash or make a preview."""
    if not value:
        return None
    candidate = Path(value)
    try:
        stat = candidate.stat()
        if candidate.is_file() and stat.st_size > 0 and not getattr(stat, "st_flags", 0) & 0x40000000:
            return candidate
    except OSError:
        pass
    return None


def identity(source, name):
    return hashlib.sha256(f"{source}\0{name}".encode()).hexdigest()[:32]


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_state(path):
    path = Path(path).resolve()
    if path == ROOT or (path.is_relative_to(ROOT) and not path.is_relative_to(ROOT / ".local-photos")):
        raise ValueError("照片索引必须保存在被 Git 忽略的 .local-photos 目录中。")
    if any(parent.suffix == ".photoslibrary" for parent in [path, *path.parents]):
        raise ValueError("照片索引不能写入系统照片图库中。")
    # Hugo does not mount .local-photos, and Git ignores it. Reject publishable destinations.
    for name in ("content", "static", "assets", "layouts", "public", "resources"):
        if path.is_relative_to(ROOT / name):
            raise ValueError("照片索引不能保存在 Hugo 源码或发布目录中。")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)
    return path


class Library:
    def __init__(self, state=STATE, source=None):
        self.state = safe_state(state)
        self.database = self.state / "catalog.sqlite"
        self.previews = self.state / "previews"
        self.previews.mkdir(exist_ok=True, mode=0o700)
        self.lock = threading.Lock()
        self.preview_lock = threading.Lock()
        self.preview_pool = ThreadPoolExecutor(max_workers=3)
        self.preview_jobs = {}
        self.snapshot_lock = threading.Lock()
        self.snapshot_cache = None
        with self.connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, source TEXT, data TEXT);
                CREATE INDEX IF NOT EXISTS source_index ON photos(source);
                CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, data TEXT);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT);
            """)
        self.database.chmod(0o600)
        self.source = source or self.setting("source", {
            "kind": "photos", "path": str(Path.home() / "Pictures" / "Photos Library.photoslibrary")
        })
        self.save_setting("source", self.source)
        previous = self.setting("status", {})
        self.status = {"phase": "idle", "message": "刷新相册后，可读取本机照片。", "processed": 0,
                       "updated_at": previous.get("updated_at"), "duplicates_checked": False}
        if previous.get("phase") in {"ready", "error"}:
            self.status.update(previous)
            if previous['phase'] == 'ready':
                with self.connect() as connection:
                    total = connection.execute('SELECT count(*) FROM photos WHERE source=?', (self.source_key,)).fetchone()[0]
                    duplicates = connection.execute("SELECT count(DISTINCT json_extract(data, '$.duplicate')) FROM photos WHERE source=?", (self.source_key,)).fetchone()[0]
                self.status['message'] = (f"发现 {duplicates} 组完全重复照片，已检查 {previous.get('duplicate_coverage', 0):,} 张本地原图；云端原图未参与比较。"
                                          if previous.get('duplicates_checked') else f"已收录 {total:,} 张照片。")
        self.organizer = Organizer(self)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database, timeout=30)
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def setting(self, key, default=None):
        with self.connect() as connection:
            row = connection.execute("SELECT data FROM settings WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def save_setting(self, key, value):
        with self.connect() as connection:
            connection.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value)))

    def progress(self, **values):
        self.status = {**self.status, **values}

    def invalidate(self):
        with self.snapshot_lock:
            self.snapshot_cache = None

    def snapshot(self):
        with self.snapshot_lock:
            if self.snapshot_cache is None:
                with self.connect() as connection:
                    annotations = {row[0]: json.loads(row[1]) for row in connection.execute("SELECT id,data FROM annotations")}
                self.snapshot_cache = sorted(
                    (self.public(record, annotations.get(record["id"], {})) for record in self.raw_photos()),
                    key=lambda photo: (photo["date"], photo["id"]), reverse=True)
            return self.snapshot_cache

    def raw_photos(self):
        with self.connect() as connection:
            rows = connection.execute("SELECT data FROM photos WHERE source=?", (self.source_key,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    @property
    def source_key(self):
        return f"{self.source['kind']}:{Path(self.source['path']).expanduser().resolve()}"

    def scan_photos(self, path):
        try:
            # Permission check before importing the provider; do not write anything into the library.
            with (path / "database" / "Photos.sqlite").open("rb") as handle:
                handle.read(16)
        except PermissionError as error:
            raise PermissionError(PERMISSION_MESSAGE) from error
        try:
            import osxphotos
        except ImportError as error:
            raise RuntimeError("读取系统图库需要本地依赖，请先运行 npm run photos:setup。") from error
        provider = osxphotos.PhotosDB(str(path))
        photos = provider.photos(images=True, movies=False, intrash=False)
        for photo in photos:
            if photo.hidden or photo.intrash:
                continue
            original = local_file(photo.path)
            # Edited rendition > on-disk derivative > original. No export/download call is made.
            preview = local_file(photo.path_edited)
            if not preview:
                preview = next((value for value in (local_file(p) for p in photo.path_derivatives) if value), None)
            preview = preview or original
            date = photo.date.isoformat() if photo.date else ""
            position = coordinates(photo.latitude, photo.longitude)
            place = ""
            city, province, country, country_code = '', '', '', ''
            try:
                address = photo.place.address if photo.place else None
                if address:
                    city, province, country = address.city or '', address.state_province or '', address.country or ''
                    country_code = address.iso_country_code or ''
                place = ", ".join(dict.fromkeys(value for value in
                                  [address.city, address.state_province, address.country] if value)) if address else ""
            except (AttributeError, ValueError, TypeError):
                pass
            yield {
                "id": identity(self.source_key, photo.uuid), "filename": photo.original_filename or photo.filename,
                "title": photo.title or "", "description": photo.description or "", "date": date,
                "date_source": "capture", "width": photo.width or 0, "height": photo.height or 0,
                "albums": list(photo.albums or []), "tags": list(photo.keywords or []),
                "source_favorite": bool(photo.favorite), "original_path": str(original) if original else None,
                "preview_source": str(preview) if preview else None, "kind": "photo",
                "availability": "local" if original else ("preview" if preview else "unavailable"),
                "in_cloud": bool(photo.incloud), "duplicate": None,
                "location": position, "place": place,
                "city": city, "province": province, "country": country, "country_code": country_code,
                "screenshot": bool(getattr(photo, 'screenshot', False)),
            }

    def scan_folder(self, path):
        if path.suffix == ".photoslibrary":
            raise ValueError("请将这个图库的来源类型设为 macOS 照片图库。")
        if not path.is_dir():
            raise ValueError("请选择一个存在的本地照片文件夹。")
        def failed(error):
            raise error
        for directory, folders, files in os.walk(path, followlinks=False, onerror=failed):
            folders[:] = sorted(folder for folder in folders if not folder.startswith(".") and
                                 not folder.endswith(".photoslibrary") and not Path(directory, folder).is_symlink())
            for filename in sorted(files):
                candidate = Path(directory, filename)
                if candidate.is_symlink() or candidate.suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                file = local_file(candidate)
                stat = candidate.stat()
                date = dt.datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat()
                date_source, width, height = "file", 0, 0
                position = None
                if file:
                    try:
                        from PIL import Image
                        with Image.open(file) as image:
                            width, height = image.size
                            exif = image.getexif()
                            position = folder_location(exif)
                            raw_date = exif.get_ifd(34665).get(36867) or exif.get(306)
                            if raw_date:
                                date = dt.datetime.strptime(raw_date, "%Y:%m:%d %H:%M:%S").isoformat()
                                date_source = "capture"
                    except (ImportError, OSError, ValueError, TypeError, KeyError):
                        pass
                relative = candidate.relative_to(path)
                album = str(relative.parent) if relative.parent != Path(".") else path.name
                yield {"id": identity(self.source_key, str(relative)), "filename": filename, "title": "",
                       "description": "", "date": date, "date_source": date_source, "width": width,
                       "height": height, "albums": [album], "tags": [], "source_favorite": False,
                       "original_path": str(file) if file else None, "preview_source": str(file) if file else None,
                       "kind": "photo", "availability": "local" if file else "unavailable",
                       "in_cloud": False, "duplicate": None, "location": position, "place": ""}

    def scan(self):
        self.progress(phase="scanning", message="正在读取本机照片信息…", processed=0, duplicates_checked=False)
        try:
            path = Path(self.source["path"]).expanduser().resolve()
            iterator = self.scan_photos(path) if self.source["kind"] == "photos" else self.scan_folder(path)
            # Commit the complete snapshot only: errors leave the last good index intact.
            records = []
            previous = {photo["id"]: photo for photo in self.raw_photos()}
            for record in iterator:
                old = previous.get(record["id"], {})
                original = local_file(record["original_path"])
                record["signature"] = f"{original.stat().st_size}:{original.stat().st_mtime_ns}" if original else None
                if record["signature"] and old.get("signature") == record["signature"]:
                    record["sha256"] = old.get("sha256")
                records.append(record)
                if len(records) % 100 == 0:
                    self.progress(processed=len(records))
            with self.connect() as connection:
                connection.execute("DELETE FROM photos WHERE source=?", (self.source_key,))
                connection.executemany("INSERT OR REPLACE INTO photos VALUES (?,?,?)",
                                       ((record["id"], self.source_key, json.dumps(record)) for record in records))
            self.invalidate()
            self.progress(phase="ready", message=f"已收录 {len(records):,} 张照片。", processed=len(records), updated_at=now())
        except Exception as error:
            self.progress(phase="error", message=PERMISSION_MESSAGE if isinstance(error, PermissionError) else str(error))
        self.save_setting("status", self.status)

    def duplicates(self):
        self.progress(phase="duplicates", message="正在比较本地原图…", processed=0)
        try:
            records = self.raw_photos()
            sizes = collections.defaultdict(list)
            for record in records:
                record["duplicate"] = None
                file = local_file(record.get("original_path"))
                if file:
                    sizes[file.stat().st_size].append(record)
            groups = collections.defaultdict(list)
            checked = 0
            for candidates in sizes.values():
                if len(candidates) < 2:
                    continue
                for record in candidates:
                    file = local_file(record.get("original_path"))
                    if not file:
                        continue
                    stat = file.stat()
                    signature = f"{stat.st_size}:{stat.st_mtime_ns}"
                    digest = record.get("sha256") if signature == record.get("signature") else None
                    if not digest:
                        with file.open("rb") as handle:
                            digest = hashlib.file_digest(handle, "sha256").hexdigest()
                        after = file.stat()
                        if (stat.st_size, stat.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                            continue
                    record["sha256"], record["signature"] = digest, signature
                    groups[digest].append(record)
                    checked += 1
                    self.progress(processed=checked)
            group_count = 0
            for digest, group in groups.items():
                if len(group) > 1:
                    group_count += 1
                    for record in group:
                        record["duplicate"] = digest
            with self.connect() as connection:
                connection.executemany("UPDATE photos SET data=? WHERE id=?",
                                       ((json.dumps(record), record["id"]) for record in records))
            self.invalidate()
            self.progress(phase="ready", message=f"发现 {group_count} 组完全重复照片。",
                          duplicates_checked=True, duplicate_coverage=sum(len(group) for group in sizes.values()), updated_at=now())
            self.progress(message=f"发现 {group_count} 组完全重复照片，已检查 "
                          f"{self.status['duplicate_coverage']:,} 张本地原图；云端原图未参与比较。")
        except Exception as error:
            self.progress(phase="error", message=str(error))
        self.save_setting("status", self.status)

    def start(self, operation="scan", source=None):
        if not self.lock.acquire(blocking=False):
            raise ValueError("照片整理任务正在运行，请稍候。")
        try:
            if source:
                if source.get("kind") not in {"photos", "folder"} or not isinstance(source.get("path"), str) or not source["path"].strip():
                    raise ValueError("请选择系统照片图库或本地文件夹。")
                self.source = {"kind": source["kind"], "path": str(Path(source["path"]).expanduser().resolve())}
                self.save_setting("source", self.source)
                self.invalidate()
            self.progress(phase="scanning" if operation == "scan" else "duplicates", message="正在开始…", processed=0)
            def task():
                try:
                    self.scan() if operation == "scan" else self.duplicates()
                finally:
                    self.lock.release()
            threading.Thread(target=task, daemon=True).start()
        except Exception:
            self.lock.release()
            raise

    def annotation(self, photo_id, update):
        self.get(photo_id)
        allowed = {"favorite", "tags", "album", "note", "category", "media_type", "review"}
        if set(update) - allowed:
            raise ValueError("存在不支持的照片详情字段。")
        for field, choices in [('category', CATEGORIES), ('media_type', TYPES), ('review', {'unreviewed', 'keep', 'delete'})]:
            if field in update and (not isinstance(update[field], str) or update[field] not in choices and (field == 'review' or update[field] != '')):
                raise ValueError('分类或复核状态无效。')
        if "favorite" in update and not isinstance(update["favorite"], bool):
            raise ValueError("收藏状态无效。")
        if "tags" in update and (not isinstance(update["tags"], list) or len(update["tags"]) > 30 or
                                 any(not isinstance(tag, str) or len(tag) > 80 for tag in update["tags"])):
            raise ValueError("最多添加 30 个标签，每个标签不超过 80 个字符。")
        for key in ("album", "note"):
            if key in update and (not isinstance(update[key], str) or len(update[key]) > (120 if key == "album" else 4000)):
                raise ValueError("填写的照片详情过长。")
        with self.connect() as connection:
            row = connection.execute("SELECT data FROM annotations WHERE id=?", (photo_id,)).fetchone()
            data = {**(json.loads(row[0]) if row else {}), **update}
            if "tags" in data:
                data["tags"] = sorted(set(tag.strip() for tag in data["tags"] if tag.strip()))
            connection.execute("INSERT OR REPLACE INTO annotations VALUES (?,?)", (photo_id, json.dumps(data)))
        self.invalidate()
        return self.public(self.get(photo_id), data)

    def get(self, photo_id):
        with self.connect() as connection:
            row = connection.execute("SELECT data FROM photos WHERE id=? AND source=?", (photo_id, self.source_key)).fetchone()
        if not row:
            raise FileNotFoundError("当前相册中没有这张照片。")
        return json.loads(row[0])

    def public(self, record, annotation):
        photo = {key: value for key, value in record.items() if key not in {
            "original_path", "preview_source", "sha256", "signature", "source_favorite"}}
        photo["favorite"] = annotation.get("favorite", record["source_favorite"])
        photo["tags"] = sorted(set(record["tags"] + annotation.get("tags", [])))
        photo["custom_tags"] = annotation.get("tags", [])
        photo["custom_album"] = annotation.get("album", "")
        photo["note"] = annotation.get("note", "")
        if photo["custom_album"]:
            photo["albums"] = sorted(set(photo["albums"] + [photo["custom_album"]]))
        # Availability was checked without opening placeholders during scanning.
        # Files disappearing later are handled by the media endpoints; refresh updates the index.
        photo["has_preview"] = bool(record.get("preview_source"))
        photo["has_original"] = bool(record.get("original_path"))
        photo["availability"] = "local" if photo["has_original"] else ("preview" if photo["has_preview"] else "unavailable")
        photo.update(self.organizer.public(record, annotation))
        photo['tags'] = sorted(set(photo['tags'] + photo['analysis_tags']))
        return photo

    def catalog(self, params):
        all_photos = self.snapshot()
        stats = {"total": len(all_photos), "local": 0, "preview": 0, "unavailable": 0, "favorites": 0, "duplicates": 0}
        months, albums = collections.Counter(), collections.Counter()
        for photo in all_photos:
            stats[photo["availability"]] += 1
            stats["favorites"] += int(photo["favorite"])
            stats["duplicates"] += int(bool(photo["duplicate"]))
            months[photo["date"][:7] or "不详"] += 1
            albums.update(photo["albums"])
        query, view = params.get("q", "").casefold(), params.get("view", "all")
        filtered, eligible = [], []
        for photo in all_photos:
            if params.get("month") and not photo["date"].startswith(params["month"]):
                continue
            if params.get("album") and params["album"] not in photo["albums"]:
                continue
            if view == "favorites" and not photo["favorite"]:
                continue
            if view == "duplicates" and not photo["duplicate"]:
                continue
            if view in {"local", "preview", "unavailable"} and photo["availability"] != view:
                continue
            if view == 'organize' and params.get('category') and photo.get('category') != params['category']:
                continue
            if params.get('media_type') and photo.get('media_type') != params['media_type']:
                continue
            if params.get('review') and photo.get('review') != params['review']:
                continue
            if params.get('category') and photo.get('category') != params['category']:
                continue
            if params.get('unprocessed') == '1' and photo.get('analyzed'):
                continue
            eligible.append(photo)
            searchable = " ".join([photo["filename"], photo["title"], photo["description"], photo["date"], photo["note"],
                                    photo.get('ocr_text', ''), *photo["tags"], *photo["albums"]]).casefold()
            if query and query not in searchable:
                continue
            filtered.append(photo)
        if params.get('mode') == 'semantic' and params.get('q'):
            filtered = self.organizer.search(params['q'], eligible)
        if view == "duplicates":
            filtered.sort(key=lambda photo: (photo["duplicate"], photo["date"]))
        offset = max(0, int(params.get("offset", 0)))
        limit = min(200, max(1, int(params.get("limit", 80))))
        return {"photos": filtered[offset:offset + limit], "count": len(filtered), "stats": stats,
                "months": dict(sorted(months.items(), reverse=True)), "albums": dict(sorted(albums.items())),
                "status": self.status, "source": self.source}

    def journeys(self):
        return journey_lists(self.snapshot(), self.setting(f"journeys:{self.source_key}", []))

    def footprints(self, params):
        result = build_footprints(self.snapshot(), params.get('year', ''))
        result['cities'] = [{key: value for key, value in city.items() if key != 'photo_ids'} for city in result['cities']]
        return result

    def footprint_city(self, identifier, params):
        snapshot = self.snapshot()
        result = build_footprints(snapshot, params.get('year', ''))
        city = next((city for city in result['cities'] if city['id'] == identifier), None)
        if not city:
            raise FileNotFoundError('当前相册中没有这个城市。')
        ids = set(city['photo_ids'])
        photos = sorted((photo for photo in snapshot if photo['id'] in ids), key=lambda photo: photo['date'], reverse=True)
        days = collections.Counter(photo['date'][:10] for photo in photos if photo['date'])
        offset = max(0, int(params.get('offset', 0)))
        limit = min(200, max(1, int(params.get('limit', 60))))
        return {'city': {key: value for key, value in city.items() if key != 'photo_ids'},
                'photos': photos[offset:offset + limit], 'count': len(photos), 'days': dict(sorted(days.items(), reverse=True))}

    def journey(self, identifier):
        lists = self.journeys()
        entry = next((entry for entry in lists["saved"] + lists["suggestions"] if entry["id"] == identifier), None)
        if not entry:
            raise FileNotFoundError("未找到这个旅行相册。")
        return journey_detail(entry, self.snapshot())

    def save_journey(self, data):
        entry = create_journey(data, self.snapshot())
        saved = self.setting(f"journeys:{self.source_key}", [])
        if len(saved) >= 100:
            raise ValueError("最多可保存 100 个旅行相册。")
        saved.append(entry)
        self.save_setting(f"journeys:{self.source_key}", saved)
        return entry

    def preview(self, photo_id, large=False):
        record = self.get(photo_id)
        source = local_file(record.get("preview_source"))
        if not source:
            raise FileNotFoundError("这张照片在本机没有可用预览。")
        stat = source.stat()
        size = 1800 if large else 560
        key = hashlib.sha256(f"{source}:{stat.st_mtime_ns}:{stat.st_size}:{size}".encode()).hexdigest()
        target = self.previews / f"{key}.jpg"
        if target.is_file():
            return target
        with self.preview_lock:
            job = self.preview_jobs.get(key)
            if not job:
                job = self.preview_pool.submit(self.make_preview, source, target, size)
                self.preview_jobs[key] = job
        try:
            return job.result(timeout=65)
        finally:
            if job.done():
                with self.preview_lock:
                    self.preview_jobs.pop(key, None)

    def make_preview(self, source, target, size):
        descriptor, temporary = tempfile.mkstemp(suffix=".jpg", dir=self.previews)
        os.close(descriptor)
        temporary = Path(temporary)
        try:
            try:
                from PIL import Image, ImageOps
                with Image.open(source) as image:
                    image = ImageOps.exif_transpose(image)
                    image.thumbnail((size, size))
                    if image.mode in {"RGBA", "LA"}:
                        background = Image.new("RGB", image.size, "white")
                        background.paste(image, mask=image.getchannel("A"))
                        image = background
                    else:
                        image = image.convert("RGB")
                    image.save(temporary, format="JPEG", quality=85)
            except (ImportError, OSError, ValueError):
                if sys.platform != "darwin":
                    raise ValueError("此照片格式需要 Pillow 或 macOS 图片支持。")
                subprocess.run(["/usr/bin/sips", "-s", "format", "jpeg", "-Z", str(size), str(source),
                                "--out", str(temporary)], check=True, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=60)
                # sips can retain source metadata; rewrite the JPEG without EXIF/GPS.
                from PIL import Image, ImageOps
                with Image.open(temporary) as converted:
                    image = ImageOps.exif_transpose(converted).convert("RGB")
                    image.save(temporary, format="JPEG", quality=85)
            temporary.replace(target)
            return target
        finally:
            temporary.unlink(missing_ok=True)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, library, site=None, map_config=None):
        if address[0] != "127.0.0.1":
            raise ValueError("照片服务只能监听 127.0.0.1。")
        self.library, self.site, self.token = library, Path(site).resolve() if site else None, secrets.token_urlsafe(32)
        self.map_config = load_amap_config(ROOT / '.env.amap.local') if map_config is None else map_config
        super().__init__(address, Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # URLs may contain personal search terms.

    def headers_for(self, content_type, length):
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        # AMap's domain allowlist requires an origin Referer. Do not expose photo paths or queries.
        self.send_header("Referrer-Policy", "strict-origin" if self.server.map_config.get('enabled') else "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        if self.path.startswith("/local-photos/") or self.path.startswith("/api/"):
            if self.server.map_config.get('enabled'):
                domains = 'https://*.amap.com https://*.autonavi.com'
                policy = (f"default-src 'self'; img-src 'self' data: blob: {domains}; "
                          f"style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval' {domains}; "
                          f"connect-src 'self' {domains}; worker-src 'self' blob:; font-src 'self' data: {domains}; "
                          "object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            else:
                policy = ("default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; "
                          "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.send_header("Content-Security-Policy", policy)
        self.end_headers()

    def respond(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.headers_for("application/json; charset=utf-8", len(body))
        if self.command != "HEAD":
            self.wfile.write(body)

    def valid_host(self):
        if self.headers.get("Host") != urlsplit(self.server.origin).netloc:
            self.respond(403, {"error": "请使用服务启动时显示的本机地址。"})
            return False
        if self.headers.get("Sec-Fetch-Site") in {"cross-site", "same-site"}:
            self.respond(403, {"error": "本地照片服务不允许跨站访问。"})
            return False
        return True

    def file(self, path, content_type=None, download=None):
        with Path(path).open("rb") as handle:
            stat = os.fstat(handle.fileno())
            self.send_response(200)
            if download:
                from urllib.parse import quote
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(download)}")
            self.headers_for(content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream", stat.st_size)
            if self.command != "HEAD":
                while data := handle.read(128 * 1024):
                    self.wfile.write(data)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.valid_host():
            return
        try:
            url = urlsplit(self.path)
            params = {key: values[0] for key, values in parse_qs(url.query).items()}
            path = unquote(url.path)
            if path == "/api/photos":
                self.respond(200, self.server.library.catalog(params))
            elif path == "/api/status":
                self.respond(200, {"status": self.server.library.status, "source": self.server.library.source,
                                   "token": self.server.token})
            elif path == "/api/map-config":
                self.respond(200, self.server.map_config)
            elif path == '/api/footprints':
                self.respond(200, self.server.library.footprints(params))
            elif path == '/api/organize':
                self.respond(200, self.server.library.organizer.summary())
            elif path.startswith('/api/footprints/'):
                self.respond(200, self.server.library.footprint_city(path.removeprefix('/api/footprints/'), params))
            elif path == "/api/journeys":
                self.respond(200, self.server.library.journeys())
            elif path.startswith("/api/journeys/"):
                self.respond(200, self.server.library.journey(path.removeprefix("/api/journeys/")))
            elif path.startswith("/api/preview/"):
                self.file(self.server.library.preview(path.removeprefix("/api/preview/"), params.get("size") == "large"), "image/jpeg")
            elif path.startswith("/api/original/"):
                record = self.server.library.get(path.removeprefix("/api/original/"))
                original = local_file(record.get("original_path"))
                if not original:
                    raise FileNotFoundError("原图不在本机，请先在系统照片中下载。")
                self.file(original, download=record["filename"])
            elif path == "/api/export":
                records = self.server.library.raw_photos()
                with self.server.library.connect() as connection:
                    annotations = {row[0]: json.loads(row[1]) for row in connection.execute("SELECT id,data FROM annotations")}
                payload = {"created_at": now(), "photos": [self.server.library.public(p, annotations.get(p["id"], {})) for p in records]}
                body = json.dumps(payload, ensure_ascii=False, indent=2).encode()
                self.send_response(200)
                self.send_header("Content-Disposition", 'attachment; filename="local-photo-catalog.json"')
                self.headers_for("application/json; charset=utf-8", len(body))
                if self.command != "HEAD":
                    self.wfile.write(body)
            elif path == "/local-photos":
                self.send_response(302)
                self.send_header("Location", "/local-photos/")
                self.headers_for("text/plain", 0)
            elif path.startswith("/local-photos/"):
                name = path.removeprefix("/local-photos/") or "index.html"
                if name == 'travel-map-platform.js':
                    self.file(ROOT / 'static/js/travel-map-platform.js')
                    return
                if name not in {"index.html", "app.js", "journeys.js", "organize.js", "amap-map.js", "footprints.js", "boundary-cache.js", "coordtransform.js", "style.css", "favicon.svg", "land.geojson"}:
                    raise FileNotFoundError()
                self.file(UI / name)
            elif self.server.site:
                candidate = (self.server.site / path.lstrip("/")).resolve()
                if not candidate.is_relative_to(self.server.site):
                    raise FileNotFoundError()
                if candidate.is_dir():
                    candidate /= "index.html"
                self.file(candidate)
            elif path == "/":
                self.send_response(302)
                self.send_header("Location", "/local-photos/")
                self.headers_for("text/plain", 0)
            else:
                raise FileNotFoundError()
        except (FileNotFoundError, PermissionError):
            self.respond(404, {"error": "这个本地文件暂不可用。"})
        except (ValueError, TypeError):
            self.respond(400, {"error": "请求无效。"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(500, {"error": "无法读取这张本地照片，请刷新相册后重试。"})

    def do_POST(self):
        if not self.valid_host():
            return
        if (self.headers.get("Origin") != self.server.origin or
                self.headers.get("X-Photo-Token") != self.server.token or
                self.headers.get("Content-Type", "").split(";")[0] != "application/json"):
            self.respond(403, {"error": "请在本地照片页面中修改整理信息。"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 16384:
                raise ValueError("请求大小无效。")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("请求无效。")
            path = urlsplit(self.path).path
            if path == "/api/scan":
                self.server.library.start(source=data.get("source"))
                self.respond(202, {"status": self.server.library.status})
            elif path == "/api/duplicates":
                self.server.library.start("duplicates")
                self.respond(202, {"status": self.server.library.status})
            elif path == '/api/analysis/start':
                limit = data.get('limit')
                if limit is not None and (not isinstance(limit, int) or not 1 <= limit <= 100000):
                    raise ValueError('请设置有效的分析数量。')
                self.server.library.organizer.start(limit)
                self.respond(202, {'status': self.server.library.organizer.status})
            elif path == '/api/analysis/stop':
                self.server.library.organizer.cancel.set()
                self.respond(200, {'status': self.server.library.organizer.status})
            elif path == '/api/review':
                ids, review = data.get('ids'), data.get('review')
                if not isinstance(ids, list) or not 1 <= len(ids) <= 200 or any(not isinstance(value, str) for value in ids):
                    raise ValueError('每次可复核 1 到 200 张照片。')
                for identifier in ids:
                    self.server.library.get(identifier)
                for identifier in ids:
                    self.server.library.annotation(identifier, {'review': review})
                self.respond(200, {'updated': len(ids)})
            elif path == "/api/journeys":
                self.respond(201, self.server.library.save_journey(data))
            elif path == "/api/story":
                journey = self.server.library.journey(data.get("id", ""))
                body = export_story(journey, self.server.library, data)
                self.send_response(200)
                self.send_header("Content-Disposition", 'attachment; filename="photo-journey.html"')
                self.headers_for("text/html; charset=utf-8", len(body))
                self.wfile.write(body)
            elif path.startswith("/api/annotations/"):
                self.respond(200, self.server.library.annotation(path.removeprefix("/api/annotations/"), data))
            else:
                raise FileNotFoundError()
        except FileNotFoundError:
            self.respond(404, {"error": "未找到这张照片。"})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.respond(400, {"error": str(error)})
        except Exception:
            self.respond(500, {"error": "本地修改未能保存，请重试。"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--state", type=Path, default=STATE)
    parser.add_argument("--site", type=Path)
    parser.add_argument("--library", type=Path)
    parser.add_argument("--folder", type=Path)
    parser.add_argument("--no-scan", action="store_true")
    parser.add_argument("--offline-map", action="store_true", help="Disable all online map loading.")
    args = parser.parse_args()
    if args.folder and args.library:
        parser.error("Choose --library or --folder, not both.")
    source = {"kind": "folder" if args.folder else "photos", "path": str(args.folder or args.library)} if args.folder or args.library else None
    library = Library(args.state, source)
    server = Server(("127.0.0.1", args.port), library, args.site, {} if args.offline_map else None)
    if not args.no_scan:
        library.start()
    print(f"本地相册: {server.origin}/local-photos/", flush=True)
    print("Only listening on 127.0.0.1. Original photos are read-only. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        library.preview_pool.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
