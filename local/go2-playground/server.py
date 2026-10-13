"""Loopback-only Go2 viewer. Rendering stays on its owning simulation thread."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".cache/matplotlib"))
os.environ.setdefault("OMP_NUM_THREADS", "2")
import asyncio
from contextlib import asynccontextmanager
from io import BytesIO
import json
import queue
import re
import subprocess
import sys
import threading
import time
import uuid
from typing import Literal
import mujoco
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from go2_env import Go2Env

RUNS = ROOT / "runs"
RUNS.mkdir(exist_ok=True)


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def run_directory(run_id):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", run_id):
        raise HTTPException(400, "无效的实验编号")
    directory = RUNS / run_id
    if not directory.is_dir():
        raise HTTPException(404, "实验不存在")
    return directory


class Simulation:
    def __init__(self):
        self.commands = queue.Queue()
        self.state = {"ready": False, "message": "正在载入 Go2 物理模型"}
        self.frame = None
        self.shutdown = threading.Event()
        self.thread = threading.Thread(target=self.loop, name="go2-render", daemon=True)

    def loop(self):
        renderer = None
        try:
            env = Go2Env(randomize=False, max_steps=1_000_000_000)
            env.command[:] = [0, 0, 0]
            env.model.vis.global_.offwidth = 960
            env.model.vis.global_.offheight = 540
            renderer = mujoco.Renderer(env.model, height=540, width=960)
            camera = mujoco.MjvCamera()
            camera.type = mujoco.mjtCamera.mjCAMERA_FREE
            camera.distance, camera.azimuth, camera.elevation = 1.8, 135, -20
            mode, paused, policy, checkpoint = "standing", False, None, None
            reward, info, obs = 0.0, {}, env._obs()
            push_frames, tick, frames, last_fps_time, fps = 0, 0, 0, time.monotonic(), 0.0
            last_error = None
            rng = np.random.default_rng(42)
            while not self.shutdown.is_set():
                started = time.monotonic()
                while not self.commands.empty():
                    command = self.commands.get_nowait()
                    if command.get("action") == "reset":
                        obs, _ = env.reset()
                        paused, reward, info, push_frames = False, 0.0, {}, 0
                    if command.get("action") == "push":
                        push_frames = 5
                    if command.get("action") == "toggle":
                        paused = not paused
                    if "paused" in command:
                        paused = command["paused"]
                    if "command" in command:
                        env.command[:] = command["command"]
                        obs = env._obs()
                    if "azimuth" in command:
                        camera.azimuth = command["azimuth"]
                    if "checkpoint" in command:
                        try:
                            import torch
                            from stable_baselines3 import PPO
                            torch.set_num_threads(2)
                            policy = PPO.load(RUNS / command["checkpoint"] / "policy.zip", device="cpu")
                            checkpoint, mode, last_error = command["checkpoint"], "trained", None
                            obs, _ = env.reset()
                            paused = False
                        except Exception as exc:
                            last_error = str(exc)
                    elif "mode" in command:
                        mode = command["mode"]
                        obs, _ = env.reset()
                        paused = False
                if not paused:
                    if mode == "trained" and policy is not None:
                        action = policy.predict(obs, deterministic=True)[0]
                    elif mode == "random":
                        action = rng.uniform(-0.5, 0.5, 12)
                    else:
                        action = np.zeros(12)
                    env.data.xfrc_applied[:] = 0
                    if push_frames:
                        env.data.xfrc_applied[env.base, 1] = 50.0
                        push_frames -= 1
                    obs, reward, done, truncated, info = env.step(action)
                    if done or truncated:
                        paused = True
                tick += 1
                if tick % 2 == 0 or self.frame is None:
                    camera.lookat[:] = env.data.xpos[env.base] + [0, 0, 0.04]
                    renderer.update_scene(env.data, camera=camera)
                    output = BytesIO()
                    Image.fromarray(renderer.render()).save(output, format="JPEG", quality=85)
                    self.frame = output.getvalue()
                    frames += 1
                    elapsed = time.monotonic() - last_fps_time
                    if elapsed > 1:
                        fps, frames, last_fps_time = frames / elapsed, 0, time.monotonic()
                linear, angular, gravity = env.body_state()
                feet = {}
                for foot in ("FL", "FR", "RL", "RR"):
                    gid = mujoco.mj_name2id(env.model, mujoco.mjtObj.mjOBJ_GEOM, foot)
                    feet[foot] = any(gid in (c.geom1, c.geom2) for c in env.data.contact)
                self.state = {"ready": True, "mode": mode, "paused": paused, "checkpoint": checkpoint,
                              "command": env.command.tolist(), "sim_seconds": round(env.data.time, 2),
                              "height": round(float(env.data.xpos[env.base, 2]), 3),
                              "velocity": np.round(linear, 3).tolist(), "yaw_rate": round(float(angular[2]), 3),
                              "upright": round(float(-gravity[2]), 3), "reward": round(reward, 3),
                              "reward_terms": info.get("reward_terms", {}), "fallen": info.get("fallen", False),
                              "joints": np.round(env.data.qpos[env.qadr], 3).tolist(), "feet": feet,
                              "fps": round(fps, 1), "last_error": last_error, "updated_at": time.time()}
                self.shutdown.wait(max(0, env.dt - (time.monotonic() - started)))
        except Exception as exc:
            self.state = {"ready": False, "error": repr(exc)}
            import traceback
            traceback.print_exc()
        finally:
            if renderer is not None:
                renderer.close()


class Training:
    def __init__(self):
        self.process = None
        self.run_id = None
        self.log = None
        self.lock = threading.Lock()

    def start(self, steps, seed, resume):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                raise HTTPException(409, "已有训练正在运行")
            self.run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
            directory = RUNS / self.run_id
            directory.mkdir()
            command = [sys.executable, "-u", str(ROOT / "train.py"), "--steps", str(steps),
                       "--seed", str(seed), "--run-id", self.run_id]
            if resume:
                path = run_directory(resume) / "policy.zip"
                if not path.exists():
                    raise HTTPException(400, "该实验尚无可继续训练的模型")
                command += ["--resume", str(path)]
            if self.log:
                self.log.close()
            self.log = (directory / "train.log").open("w")
            self.process = subprocess.Popen(command, cwd=ROOT, stdout=self.log,
                                            stderr=subprocess.STDOUT, env=os.environ.copy())
            return {"run_id": self.run_id, "status": "starting"}

    def stop(self):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                (RUNS / self.run_id / "STOP").touch()
                return {"status": "stopping", "run_id": self.run_id}
            return {"status": "idle"}

    def status(self):
        runs = []
        for directory in sorted(RUNS.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True):
            if not directory.is_dir():
                continue
            status = read_json(directory / "progress.json", {"status": "starting", "run_id": directory.name})
            is_active = self.run_id == directory.name and self.process is not None and self.process.poll() is None
            if status["status"] in ("running", "starting", "evaluating") and not is_active:
                status["status"] = "interrupted"
                if self.run_id == directory.name and self.process is not None and self.process.returncode:
                    status["status"] = "failed"
            status["has_model"] = (directory / "policy.zip").exists()
            status["evaluation"] = read_json(directory / "evaluation.json")
            runs.append(status)
        return {"runs": runs, "active_run": self.run_id if self.process is not None and self.process.poll() is None else None}


simulation = Simulation()
training = Training()


@asynccontextmanager
async def lifespan(app):
    simulation.thread.start()
    yield
    simulation.shutdown.set()
    simulation.thread.join(timeout=3)
    training.stop()


app = FastAPI(title="Go2 RL Playground", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])


@app.middleware("http")
async def local_mutations(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method in ("POST", "PUT", "DELETE") and origin and origin != str(request.base_url).rstrip("/"):
        return JSONResponse({"detail": "只接受本机同源页面的操作"}, status_code=403)
    return await call_next(request)


@app.get("/")
def index():
    return FileResponse(ROOT / "web/index.html")


@app.get("/api/state")
def state():
    return simulation.state


@app.get("/api/system")
def system():
    return read_json(ROOT / "artifacts/system.json", {})


@app.get("/api/frame")
def frame():
    if simulation.frame is None:
        raise HTTPException(503, "仿真画面初始化中")
    return Response(simulation.frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


class Control(BaseModel):
    action: Literal["reset", "push", "toggle"] | None = None
    mode: Literal["standing", "random"] | None = None
    paused: bool | None = None
    vx: float | None = Field(default=None, ge=-0.7, le=0.7, allow_inf_nan=False)
    vy: float | None = Field(default=None, ge=-0.3, le=0.3, allow_inf_nan=False)
    yaw: float | None = Field(default=None, ge=-1, le=1, allow_inf_nan=False)
    azimuth: float | None = Field(default=None, ge=-360, le=360, allow_inf_nan=False)
    checkpoint: str | None = None


@app.post("/api/control")
def control(body: Control):
    value = body.model_dump(exclude_none=True)
    if body.checkpoint:
        if not (run_directory(body.checkpoint) / "policy.zip").exists():
            raise HTTPException(400, "模型尚未保存")
    if any(x is not None for x in (body.vx, body.vy, body.yaw)):
        current = simulation.state.get("command", [0, 0, 0])
        value["command"] = [body.vx if body.vx is not None else current[0],
                            body.vy if body.vy is not None else current[1],
                            body.yaw if body.yaw is not None else current[2]]
    simulation.commands.put(value)
    return {"queued": True}


class TrainRequest(BaseModel):
    steps: int = Field(default=65536, ge=2048, le=10000000)
    seed: int = Field(default=42, ge=0, le=2147483647)
    resume: str | None = None


@app.post("/api/train")
def start_training(body: TrainRequest):
    return training.start(body.steps, body.seed, body.resume)


@app.post("/api/train/stop")
def stop_training():
    return training.stop()


@app.get("/api/training")
def training_status():
    return training.status()


@app.get("/api/runs/{run_id}/history")
def history(run_id: str):
    path = run_directory(run_id) / "history.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


@app.get("/api/runs/{run_id}/log")
def log(run_id: str):
    path = run_directory(run_id) / "train.log"
    return {"text": path.read_text(errors="replace")[-8000:] if path.exists() else ""}


@app.get("/api/runs/{run_id}/model")
def download_model(run_id: str):
    path = run_directory(run_id) / "policy.zip"
    if not path.exists():
        raise HTTPException(404, "模型尚未保存")
    return FileResponse(path, filename=f"go2-ppo-{run_id}.zip")


app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")
