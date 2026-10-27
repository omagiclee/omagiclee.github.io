"""Trusted media operators. Artifacts carry references; files never enter graph JSON.

Handlers run under Dagster's project context. Heavy
models run in a separate Python environment and never inherit API credentials.
"""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from pydantic import Field, field_validator

from .pipeline_sdk import OperatorConfig, OperatorDefinition, PluginDefinition

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_URLS = ["https://www.youtube.com/watch?v=aqz-KE-bpKQ", "https://www.youtube.com/watch?v=R6MlUcmOul8"]
SIGLIP_MODEL = "google/siglip2-so400m-patch14-384"


def identity(*parts) -> str:
    # Asset IDs are globally keyed in SQL, so include project scope as well as
    # content identity. The same source can belong to two independent projects.
    from .media_store import current_context
    try:
        scope = current_context().project_id
    except RuntimeError:
        scope = ""
    return hashlib.sha256(json.dumps((scope, *parts), sort_keys=True).encode()).hexdigest()[:40]


def youtube_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port:
        raise ValueError("仅支持 HTTPS YouTube 视频链接")
    if parsed.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"} and parsed.path == "/watch":
        value = parse_qs(parsed.query).get("v", [""])[0]
    elif parsed.hostname == "youtu.be":
        value = parsed.path.strip("/")
    else:
        raise ValueError("仅支持 youtube.com/watch 或 youtu.be 视频链接")
    import re
    if not re.fullmatch(r"[a-zA-Z0-9_-]{11}", value):
        raise ValueError("YouTube 视频 ID 无效")
    return value


class YouTubeConfig(OperatorConfig):
    urls: list[str] = Field(default_factory=lambda: DEFAULT_URLS.copy(), min_length=1, max_length=2)
    max_height: int = Field(default=480, ge=240, le=1080)

    @field_validator("urls")
    @classmethod
    def valid_urls(cls, values):
        for url in values:
            youtube_id(url)
        return values


class AutoShotConfig(OperatorConfig):
    threshold: float = Field(default=0.5, gt=0, lt=1)


class KeyframeConfig(OperatorConfig):
    frames_per_shot: int = Field(default=1, ge=1, le=5)
    max_width: int = Field(default=640, ge=224, le=1280)


class PersonConfig(OperatorConfig):
    score_threshold: float = Field(default=0.7, gt=0, lt=1)
    backend: str = "maskrcnn"

    @field_validator("backend")
    @classmethod
    def backend_supported(cls, value):
        if value not in {"maskrcnn", "sam3.1"}:
            raise ValueError("backend must be maskrcnn or sam3.1")
        return value


class EmptyConfig(OperatorConfig):
    pass


class DoubaoConfig(OperatorConfig):
    fps: float = Field(default=1.0, gt=0, le=5)
    max_frames: int = Field(default=32, ge=4, le=64)


def run_command(arguments: list[str], timeout: float = 3600, *, output_path: Path | None = None):
    from .media_store import check_cancelled
    # A file prevents unbounded pipe buffers and keeps progress output away from
    # public task errors. Only a sanitized suffix is included on failure.
    import tempfile
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(arguments, stdout=log, stderr=log)
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                check_cancelled()
                if time.monotonic() > deadline:
                    raise TimeoutError("媒体步骤超过运行时限")
                time.sleep(0.25)
            if process.returncode:
                log.seek(0, 2)
                log.seek(max(0, log.tell() - 1200))
                message = log.read().decode(errors="replace")
                raise RuntimeError(f"{Path(arguments[0]).name} 执行失败: {message[-1000:]}")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


@contextmanager
def model_slot(module):
    if module != "app.media_inference":
        yield
        return
    # API query encoding and Dagster indexing share the same local GPU/RAM.
    # A file lock also survives process crashes without leaving a stale lease.
    import fcntl
    from .media_store import check_cancelled
    lock_path = ROOT / ".data/model-runtime.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        deadline = time.monotonic() + 7200
        while True:
            check_cancelled()
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise TimeoutError("等待本机模型资源超过两小时")
                time.sleep(0.3)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def ml_call(request: dict, *, module: str = "app.media_inference") -> dict:
    """File protocol; no key, database DSN or user session is sent to ML workers."""
    from .media_store import project_root, check_cancelled
    executable = Path(os.getenv("FLYWHEEL_MEDIA_PYTHON", str(ROOT / ".venv-media/bin/python")))
    if not executable.is_file():
        raise RuntimeError("媒体模型环境未安装，请运行 scripts/setup_media_models.py")
    scratch = project_root() / "jobs"
    scratch.mkdir(parents=True, exist_ok=True)
    token = uuid4().hex
    request_path, result_path = scratch / f"{token}.request.json", scratch / f"{token}.response.json"
    request_path.write_text(json.dumps(request, ensure_ascii=False))
    env = {key: value for key, value in os.environ.items() if key in {
        "PATH", "HOME", "TMPDIR", "HF_HOME", "HF_ENDPOINT", "HF_HUB_OFFLINE",
        "PYTORCH_ENABLE_MPS_FALLBACK", "FLYWHEEL_MEDIA_DEVICE", "FLYWHEEL_MODEL_ROOT",
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    }}
    env.update(PYTHONPATH=str(ROOT / "apps/api"), PYTHONDONTWRITEBYTECODE="1", TOKENIZERS_PARALLELISM="false")
    import tempfile
    with model_slot(module), tempfile.TemporaryFile() as log:
        process = subprocess.Popen([str(executable), "-m", module, str(request_path), str(result_path)], cwd=ROOT, env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 7200
        try:
            while process.poll() is None:
                check_cancelled()
                if time.monotonic() > deadline:
                    raise TimeoutError("模型批次超过两小时，请缩小处理批次")
                time.sleep(0.3)
            result = json.loads(result_path.read_text()) if result_path.exists() else {}
            if process.returncode or result.get("ok") is False:
                raise RuntimeError(str(result.get("error", "模型进程异常退出；检查本机内存和模型配置"))[:1500])
            return result
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            request_path.unlink(missing_ok=True)
            result_path.unlink(missing_ok=True)


def artifact(kind, records, metadata=None):
    return {"type": kind, "records": records, "metadata": metadata or {}}


def record(item):
    return {"id": item["id"], "text": item.get("title", item["id"]), "metadata": item}


def ingest(config, _):
    from .media_store import media_path, register_video, check_cancelled
    result = []
    for url in config.urls:
        check_cancelled()
        source_id = youtube_id(url)
        source_dir = ROOT / ".data/media-sources"
        source_dir.mkdir(parents=True, exist_ok=True)
        cached = source_dir / f"{source_id}.mp4"
        info_path = source_dir / f"{source_id}.info.json"
        if config.max_height != 480:
            source_dir = source_dir / str(config.max_height)
            source_dir.mkdir(parents=True, exist_ok=True)
            cached, info_path = source_dir / f"{source_id}.mp4", source_dir / f"{source_id}.info.json"
        if not cached.is_file() or not info_path.is_file():
            downloader = ROOT / ".venv-media/bin/yt-dlp"
            run_command([str(downloader) if downloader.is_file() else shutil.which("yt-dlp") or "yt-dlp", "--js-runtimes", "node", "--no-playlist", "--no-update", "--max-filesize", "650M", "--socket-timeout", "30", "--retries", "3", "-f", f"bv*[height<={config.max_height}][ext=mp4]+ba[ext=m4a]/b[height<={config.max_height}][ext=mp4]", "--merge-output-format", "mp4", "--write-info-json", "--restrict-filenames", "-o", str(source_dir / "%(id)s.%(ext)s"), f"https://www.youtube.com/watch?v={source_id}"])
        info = json.loads(info_path.read_text())
        if not cached.is_file():
            raise RuntimeError("视频下载未生成 MP4")
        if float(info.get("duration") or 0) > 1800:
            raise ValueError("本地示例单条视频最多 30 分钟")
        with cached.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        asset_id = identity("video", digest)
        relative = f"videos/{asset_id}/source.mp4"
        destination = media_path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            try:
                os.link(cached, destination)
            except OSError:
                shutil.copyfile(cached, destination)
        probe = subprocess.run([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(destination)], capture_output=True, text=True, timeout=30, check=True)
        duration_ms = round(float(json.loads(probe.stdout)["format"]["duration"]) * 1000)
        item = register_video({"id": asset_id, "source_url": f"https://www.youtube.com/watch?v={source_id}", "title": info.get("title", source_id), "duration_ms": duration_ms, "sha256": digest, "path": relative})
        result.append(record(item))
    return artifact("video_assets", result)


def autoshot(config, payload):
    from .media_store import media_path, register_shots, check_cancelled, processing_signature
    results = []
    for video in payload["records"]:
        check_cancelled()
        meta = video["metadata"]
        response = ml_call({"operation": "autoshot", "video_path": str(media_path(meta["path"], must_exist=True)), "threshold": config.threshold})
        data = response.get("result", response)
        segments = data["shots"]
        revision = f"{data['model_revision']}/threshold={config.threshold}/processing={processing_signature()}"
        rows = [{"id": identity(video["id"], revision, config.threshold, shot["start_ms"], shot["end_ms"]), "index": i, "start_ms": shot["start_ms"], "end_ms": shot["end_ms"], "segmenter_revision": revision} for i, shot in enumerate(segments)]
        results.extend(record(item) for item in register_shots(video["id"], rows))
    return artifact("shot_assets", results, {"segmenter": "AutoShot", "threshold": config.threshold})


def keyframes(config, payload):
    from .media_store import media_path, register_frames, get_video, check_cancelled
    from .media_frames import SAMPLING_REVISION, extraction_command, probe_timeline, select_shot_frames
    results = []
    sources = {}
    for shot in payload["records"]:
        check_cancelled()
        meta = shot["metadata"]
        if meta["video_id"] not in sources:
            video = get_video(meta["video_id"])
            source = media_path(video["path"], must_exist=True)
            sources[meta["video_id"]] = (source, probe_timeline(source, check_cancelled))
        source, timeline = sources[meta["video_id"]]
        rows = []
        for frame in select_shot_frames(timeline, meta["start_ms"], meta["end_ms"], config.frames_per_shot):
            check_cancelled()
            timestamp = frame.timestamp_ms
            frame_id = identity(shot["id"], SAMPLING_REVISION, frame.pts, timestamp, config.max_width)
            relative = f"frames/{frame_id}.jpg"
            destination = media_path(relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.is_file():
                temporary = destination.with_name(f"{destination.stem}.{uuid4().hex}.partial.jpg")
                try:
                    run_command(extraction_command(source, temporary, timeline, frame, config.max_width), timeout=120)
                    if not temporary.is_file() or temporary.stat().st_size == 0:
                        raise ValueError("选中的真实 PTS 未生成关键帧")
                    temporary.replace(destination)
                finally:
                    temporary.unlink(missing_ok=True)
            rows.append({"id": frame_id, "shot_id": shot["id"], "timestamp_ms": timestamp, "path": relative})
        results.extend(record(item) for item in register_frames(rows))
    return artifact("frame_assets", results, {"frames_per_shot": config.frames_per_shot,
                                             "coverage": "sampled_keyframes", "sampling_revision": SAMPLING_REVISION})


def person_segment(config, payload):
    from .media_store import media_path, update_frame
    if config.backend == "sam3.1":
        raise RuntimeError("SAM 3.1 官方接口需要 CUDA 视频 Worker 与已授权权重；本机关键帧插件请选择 maskrcnn")
    frames = []
    for item in payload["records"]:
        mask_path = f"masks/{identity(item['id'], config.score_threshold, 'maskrcnn-v2')}.png"
        media_path(mask_path).parent.mkdir(parents=True, exist_ok=True)
        frames.append({"id": item["id"], "path": str(media_path(item["metadata"]["path"], must_exist=True)), "mask_path": str(media_path(mask_path)), "relative_mask_path": mask_path})
    response = ml_call({"operation": "person_segment", "frames": frames, "score_threshold": config.score_threshold})
    data = response.get("result", response)
    by_id = {frame["id"]: frame for frame in frames}
    records = []
    for frame in data["frames"]:
        saved = update_frame(frame["id"], {"mask_path": by_id[frame["id"]]["relative_mask_path"], "detections": frame["detections"], "model_revision": data["model_revision"]})
        records.append(record(saved))
    if len(records) != len(frames):
        raise RuntimeError("分割结果缺少关键帧，不能把失败当作未检出")
    return artifact("annotated_frames", records, {**payload["metadata"], "segmentation_model": data["model_revision"]})


def siglip_embed(config, payload):
    from .media_store import media_path, update_frame
    frames = []
    for item in payload["records"]:
        relative = f"vectors/siglip2/{item['id']}.npy"
        media_path(relative).parent.mkdir(parents=True, exist_ok=True)
        frames.append({"id": item["id"], "path": str(media_path(item["metadata"]["path"], must_exist=True)), "vector_path": str(media_path(relative)), "relative_vector_path": relative})
    response = ml_call({"operation": "siglip_image", "frames": frames})
    data = response.get("result", response)
    records = []
    for frame in frames:
        if not Path(frame["vector_path"]).is_file():
            raise RuntimeError("SigLIP2 未生成所有关键帧向量")
        records.append(record(update_frame(frame["id"], {"vector_path": frame["relative_vector_path"]})))
    return artifact("frame_embeddings", records, {**payload["metadata"], "image_embedding": {"model": SIGLIP_MODEL, "revision": data["model_revision"], "dimensions": data["dimensions"]}})


def doubao_embed(config, payload):
    from .media_ark import embed_shots
    return embed_shots(config, payload)


def milvus_publish(config, payload):
    from .media_search import publish
    return publish(payload)


def plugin():
    # Pin helper modules and dependency constraints alongside the handler module.
    # Model versions are additionally frozen in the processing generation.
    sources = [Path(__file__).with_name(name) for name in ("media_inference.py", "media_ark.py", "media_search.py", "media_index_worker.py", "media_store.py", "media_frames.py", "media_object_ingest.py")]
    sources.append(ROOT / "apps/api/requirements-media.txt")
    implementation = hashlib.sha256(b"".join(path.read_bytes() for path in sources if path.is_file())).hexdigest()
    from .media_object_ingest import ObjectVideoConfig, ingest_objects
    def op(identifier, name, description, kind, input_type, output_type, config, handler, defaults=None):
        return OperatorDefinition(identifier, name, description, kind, input_type, output_type, config, handler, defaults or {}, deterministic=False, side_effects=True, implementation_revision=implementation,
            retry_safe=identifier != "media.youtube_ingest",
            cacheable=identifier not in {"media.youtube_ingest", "media.object_ingest", "media.milvus_publish", "media.doubao_video_embed"})
    return PluginDefinition("media.video", "视频理解与镜头检索", "YouTube、AutoShot、关键帧人物分割、SigLIP2、豆包视频向量与 Milvus，由 Dagster 编排执行。", (
        op("media.object_ingest", "对象存储视频入库", "读取项目已上传视频，校验内容摘要和真实视频时间线。", "source", None, "video_assets", ObjectVideoConfig, ingest_objects, {"object_uris": ["object://0000000000000000/uploads/replace-with-project-file/source.mp4"]}),
        op("media.youtube_ingest", "YouTube 视频入库", "下载两条以内、每条最多 30 分钟的视频；以内容摘要去重。", "source", None, "video_assets", YouTubeConfig, ingest, {"urls": DEFAULT_URLS, "max_height": 480}),
        op("media.autoshot", "AutoShot 镜头切分", "真实模型滑窗推理，保存镜头边界与原视频时间关系。", "transform", "video_assets", "shot_assets", AutoShotConfig, autoshot, {"threshold": 0.5}),
        op("media.keyframes", "抽取关键帧", "在每个 shot 内均匀采样；默认中间一帧，可配置 1–5 帧。", "transform", "shot_assets", "frame_assets", KeyframeConfig, keyframes, {"frames_per_shot": 1, "max_width": 640}),
        op("media.person_segment", "人物检测与分割", "本机使用 Mask R-CNN，保存人物框、置信度和掩码；标签仅代表抽样帧。", "transform", "frame_assets", "annotated_frames", PersonConfig, person_segment, {"score_threshold": 0.7, "backend": "maskrcnn"}),
        op("media.siglip2_embed", "SigLIP2 图像向量", "关键帧图文共同空间；真实模型特征，L2 归一化。", "transform", "annotated_frames", "frame_embeddings", EmptyConfig, siglip_embed),
        op("media.doubao_video_embed", "豆包 Shot 视频向量", "调用 Coding Plan doubao-embedding-vision；凭据只从后端读取。", "transform", "frame_embeddings", "frame_embeddings", DoubaoConfig, doubao_embed, {"fps": 1.0, "max_frames": 32}),
        op("media.milvus_publish", "发布 Milvus 检索索引", "图像和视频分开建索引，全部写入成功后发布 shot。", "sink", "frame_embeddings", "shot_index", EmptyConfig, milvus_publish),
    ))


def demo_graph(urls=None):
    nodes = []
    for definition in plugin().operators:
        if definition.id == "media.object_ingest":
            continue
        config = dict(definition.default_config)
        if definition.kind == "source" and urls is not None:
            config["urls"] = urls
        identifier = definition.id.split(".")[-1]
        nodes.append({"id": identifier, "operator": definition.id, "version": definition.version, "config": config, "inputs": {"data": nodes[-1]["id"]} if nodes else {}})
    return {"nodes": nodes}


def preflight():
    from .media_ark import ark_settings
    configuration = ark_settings()
    model_root = Path(os.getenv("FLYWHEEL_MODEL_ROOT", str(ROOT / ".data/models")))
    manifest = model_root / "manifest.json"
    try:
        model_info = json.loads(manifest.read_text()) if manifest.is_file() else {}
    except (ValueError, OSError):
        model_info = {}
    executable = Path(os.getenv("FLYWHEEL_MEDIA_PYTHON", str(ROOT / ".venv-media/bin/python")))
    def ready(key):
        entry = model_info.get(key) or {}
        path = Path(entry.get("path", ".missing"))
        path = path if path.is_absolute() else model_root / path
        if not executable.is_file() or not entry.get("ready") or not path.exists():
            return False
        if key == "siglip2":
            return (path / "config.json").is_file() and bool(list(path.glob("*.safetensors")))
        if key == "autoshot":
            return path.is_file() and (model_root / "autoshot/code/supernet_flattransf_3_8_8_8_13_12_0_16_60.py").is_file()
        return path.is_file()
    return {"models": [
        {"id": "autoshot", "name": "AutoShot", "available": ready("autoshot"), "detail": "需要官方 AutoShot checkpoint 和模型代码"},
        {"id": "person", "name": "Mask R-CNN", "available": ready("maskrcnn"), "detail": "本地关键帧人物检测与分割"},
        {"id": "siglip2", "name": "SigLIP2", "available": ready("siglip2"), "detail": "关键帧图像向量"},
        {"id": "doubao", "name": configuration["model"], "available": bool(configuration["key"]), "detail": "已配置凭据；连通性以实际调用结果为准" if configuration["key"] else "未配置后端凭据"},
    ], "sampling": "每个 shot 默认抽取中间一帧；未检出不代表整个镜头无人", "execution": "dagster"}
