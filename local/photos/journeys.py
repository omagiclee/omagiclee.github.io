"""Local GPS extraction, explicit travel albums and privacy-aware offline stories."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import html
import json
import math
import secrets
from pathlib import Path
from footprints import city_info


def coordinates(latitude, longitude):
    try:
        latitude, longitude = float(latitude), float(longitude)
        if math.isfinite(latitude) and math.isfinite(longitude) and -90 <= latitude <= 90 and -180 <= longitude <= 180:
            return {"lat": latitude, "lon": longitude}
    except (ValueError, TypeError):
        pass
    return None


def folder_location(exif):
    try:
        gps = exif.get_ifd(34853)
        def decimal(parts):
            return float(parts[0]) + float(parts[1]) / 60 + float(parts[2]) / 3600
        latitude, longitude = decimal(gps[2]), decimal(gps[4])
        if gps.get(1) in {"S", b"S"}:
            latitude *= -1
        if gps.get(3) in {"W", b"W"}:
            longitude *= -1
        return coordinates(latitude, longitude)
    except (ValueError, KeyError, TypeError, IndexError, ZeroDivisionError, AttributeError):
        return None


def timestamp(photo):
    try:
        date = dt.datetime.fromisoformat(photo["date"])
        return date.replace(tzinfo=date.tzinfo or dt.timezone.utc).timestamp()
    except (ValueError, TypeError):
        return 0


def distance(a, b):
    lat_a, lat_b = math.radians(a["lat"]), math.radians(b["lat"])
    delta_lat = lat_b - lat_a
    delta_lon = math.radians(b["lon"] - a["lon"])
    haversine = math.sin(delta_lat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(max(0, haversine))))


def summary(entry, photos):
    selected_ids = set(entry.get("photo_ids", []))
    selected = [photo for photo in photos if photo["id"] in selected_ids]
    located = [photo for photo in selected if photo.get("location")]
    places = list(dict.fromkeys(photo.get("place") for photo in selected if photo.get("place")))
    return {**entry, "count": len(selected), "located": len(located), "places": places[:6],
            "cover": next((photo["id"] for photo in selected if photo["has_preview"]), None)}


def journey_lists(photos, saved):
    ordered = sorted((photo for photo in photos if photo.get("date")), key=timestamp)
    sessions, current, last = [], [], None
    for photo in ordered:
        gap = timestamp(photo) - timestamp(last) if last else 0
        distant = bool(last and photo.get("location") and last.get("location") and
                       distance(photo["location"], last["location"]) > 600 and gap > 6 * 3600)
        if current and (gap > 36 * 3600 or distant or len(current) >= 400):
            sessions.append(current)
            current = []
        current.append(photo)
        last = photo
    if current:
        sessions.append(current)
    suggestions = []
    for session in reversed(sessions):
        if len(session) < 3 or sum(bool(photo.get("location")) for photo in session) < 2:
            continue
        start, end = session[0]["date"][:10], session[-1]["date"][:10]
        places = list(dict.fromkeys(photo.get("place") for photo in session if photo.get("place")))
        title = places[0] if places else f"{start} 的照片"
        identifier = "suggested-" + hashlib.sha256("|".join(photo["id"] for photo in session).encode()).hexdigest()[:16]
        entry = {"id": identifier, "title": title, "intro": "", "start": start, "end": end,
                 "photo_ids": [photo["id"] for photo in session], "suggested": True}
        suggestions.append(summary(entry, photos))
        if len(suggestions) >= 40:
            break
    return {"saved": [summary(entry, photos) for entry in reversed(saved)], "suggestions": suggestions,
            "located": sum(bool(photo.get("location")) for photo in photos), "total": len(photos)}


def create_journey(data, photos):
    title, intro = data.get("title", ""), data.get("intro", "")
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        raise ValueError("请填写旅行相册名称，最多 120 个字符。")
    if not isinstance(intro, str) or len(intro) > 4000:
        raise ValueError("相册简介过长，请控制在 4000 个字符以内。")
    start, end = data.get("start", ""), data.get("end", "")
    if not isinstance(start, str) or not isinstance(end, str):
        raise ValueError("请选择有效的起止日期。")
    try:
        dt.date.fromisoformat(start)
        dt.date.fromisoformat(end)
    except ValueError as error:
        raise ValueError("请选择有效的起止日期。") from error
    if start > end:
        raise ValueError("结束日期不能早于开始日期。")
    album = data.get("album", "")
    if not isinstance(album, str):
        raise ValueError("请选择有效的来源相册。")
    city_id = data.get('city_id', '')
    if not isinstance(city_id, str):
        raise ValueError('城市筛选无效。')
    selected = sorted((photo for photo in photos if start <= photo["date"][:10] <= end and
                       (not album or album in photo["albums"]) and
                       (not city_id or (city_info(photo) or {}).get('id') == city_id)), key=timestamp)
    if not selected:
        raise ValueError("该日期范围和相册中没有照片。")
    return {"id": "trip-" + secrets.token_hex(10), "title": title.strip(), "intro": intro.strip(),
            "start": start, "end": end, "album": album, "photo_ids": [photo["id"] for photo in selected],
            "suggested": False}


def journey_detail(entry, photos):
    selected_ids = set(entry["photo_ids"])
    selected = sorted((photo for photo in photos if photo["id"] in selected_ids), key=timestamp)
    located = [photo for photo in selected if photo.get("location")]
    line_distance = sum(distance(a["location"], b["location"]) for a, b in zip(located, located[1:]))
    return {"journey": summary(entry, photos), "photos": selected, "located": len(located),
            "point_distance_km": round(line_distance, 1), "missing_locations": len(selected) - len(located)}


def export_story(detail, library, options):
    # Self-contained HTML; no original filenames, file paths or remote resources.
    for flag in ("include_locations", "include_notes"):
        if flag in options and not isinstance(options[flag], bool):
            raise ValueError("分享选项无效。")
    limit = int(options.get("limit", 60))
    if limit not in {24, 60, 100}:
        raise ValueError("请选择最多 24、60 或 100 张照片。")
    selected = [photo for photo in detail["photos"] if photo["has_preview"]]
    if len(selected) > limit:
        selected = [selected[round(index * (len(selected) - 1) / (limit - 1))] for index in range(limit)]
    escape = html.escape
    figures, route = [], []
    missing = 0
    for index, photo in enumerate(selected, 1):
        try:
            preview = library.preview(photo["id"])
            # Mandatory rewrite strips EXIF, including any metadata retained by native conversion.
            from PIL import Image
            import io
            output = io.BytesIO()
            with Image.open(preview) as image:
                image.convert("RGB").save(output, "JPEG", quality=85)
            uri = "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()
        except (OSError, ValueError, ImportError):
            missing += 1
            continue
        date = escape(photo["date"][:10])
        caption = f"第 {index} 张照片"
        if options.get("include_notes") and photo.get("note"):
            caption = photo["note"]
        figures.append(f'<figure><img src="{uri}" alt="第 {index} 张照片" loading="lazy"><figcaption><time>{date}</time><p>{escape(caption)}</p></figcaption></figure>')
        if options.get("include_locations") and photo.get("location"):
            route.append({"lat": round(photo["location"]["lat"], 1), "lon": round(photo["location"]["lon"], 1)})
    title, intro = escape(detail["journey"]["title"]), escape(detail["journey"].get("intro", ""))
    map_html = ""
    if route:
        # Approximate coordinates only; ~0.1 degree precision. No labels or original GPS values.
        xs = [point["lon"] for point in route]
        ys = [point["lat"] for point in route]
        center = xs[0]
        xs = [center + ((longitude - center + 180) % 360 - 180) for longitude in xs]
        width, height = max(max(xs) - min(xs), .2), max(max(ys) - min(ys), .2)
        scale = min(680 / width, 200 / height)
        points = [(40 + (x - min(xs)) * scale, 240 - (y - min(ys)) * scale) for x, y in zip(xs, ys)]
        path = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
        circles = "".join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4"/>' for x, y in points)
        map_html = f'<section class="route"><h2>这些照片，串起一次旅行</h2><svg viewBox="0 0 760 280" role="img" aria-label="粗略拍摄位置之间的连线"><rect width="760" height="280" fill="#eef2e9"/><polyline points="{path}" fill="none" stroke="#52775d" stroke-width="2"/><g fill="#52775d">{circles}</g></svg><p>位置仅保留到 0.1°。连线连接拍摄点，不代表真实步行轨迹。</p></section>'
    coverage = f"已选取 {len(figures)} 张本地照片，相册共 {len(detail['photos'])} 个瞬间"
    if missing:
        coverage += f" · 导出时有 {missing} 张预览暂不可用"
    privacy = "已包含粗略位置，精确 GPS 和图片元数据已移除。" if route else "位置和图片元数据已移除。"
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>{title}</title><style>body{{margin:0;background:#faf9f5;color:#293d2c;font:15px/1.7 system-ui,sans-serif}}main{{max-width:1050px;margin:auto;padding:60px 25px}}header{{max-width:760px;margin:0 auto 45px}}.eyebrow{{font-size:11px;letter-spacing:3px;color:#7c897c}}h1{{font:48px/1.2 Georgia,serif;margin:20px 0}}h2{{font:28px Georgia,serif}}.intro{{white-space:pre-wrap}}.meta,footer,.route p{{color:#7c897c;font-size:12px}}.photos{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px}}figure{{margin:0;background:white;border-radius:9px;overflow:hidden}}img{{width:100%;aspect-ratio:4/3;object-fit:cover}}figcaption{{padding:15px 20px}}time{{font-size:11px;color:#7c897c}}figcaption p{{margin:6px 0;font-size:13px;white-space:pre-wrap}}footer{{border-top:1px solid #dce3d7;padding-top:20px;margin-top:45px}}.route{{margin-bottom:40px}}svg{{width:100%;border-radius:8px}}@media(max-width:600px){{.photos{{grid-template-columns:1fr}}h1{{font-size:36px}}main{{padding-top:35px}}}}</style></head><body><main><header><p class="eyebrow">一段照片里的旅行</p><h1>{title}</h1><p class="meta">{escape(detail['journey']['start'])} — {escape(detail['journey']['end'])}</p><p class="intro">{intro}</p><p class="meta">{coverage}</p></header>{map_html}<section class="photos">{''.join(figures)}</section><footer>{privacy} 这是一个离线文件，尚未发布到网站。</footer></main></body></html>'''.encode()
