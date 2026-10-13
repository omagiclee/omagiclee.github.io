"""Small CPU PPO runs with durable progress, graceful stop, and held-out evaluation."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".cache/matplotlib"))
os.environ.setdefault("OMP_NUM_THREADS", "2")
import argparse
from collections import deque
import json
import time
import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv
from go2_env import Go2Env


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    tmp.replace(path)


def evaluate(model, seeds=(101, 102, 103)):
    env = Go2Env(randomize=True, max_steps=300)
    results = []
    for seed in seeds:
        obs, _ = env.reset(seed=seed)
        total, errors = 0.0, []
        for step in range(300):
            action = np.zeros(12) if model is None else model.predict(obs, deterministic=True)[0]
            obs, reward, done, truncated, info = env.step(action)
            total += reward
            errors.append(info["velocity_error"])
            if done or truncated:
                break
        results.append({"seed": seed, "return": round(total, 3),
                        "survival_seconds": round((step + 1) * env.dt, 2),
                        "velocity_error": round(float(np.mean(errors)), 4), "fallen": info["fallen"]})
    env.close()
    return {"episodes": results,
            "mean_return": round(float(np.mean([x["return"] for x in results])), 3),
            "mean_velocity_error": round(float(np.mean([x["velocity_error"] for x in results])), 4),
            "mean_survival_seconds": round(float(np.mean([x["survival_seconds"] for x in results])), 2)}


class Progress(BaseCallback):
    def __init__(self, directory, total, seed, initial_steps):
        super().__init__()
        self.directory, self.total, self.seed = directory, total, seed
        self.initial_steps = initial_steps
        self.started = time.monotonic()
        self.returns, self.lengths = deque(maxlen=100), deque(maxlen=100)
        self.last_write = 0.0
        self.status = "running"
        self.episode_count = 0

    def snapshot(self):
        elapsed = max(time.monotonic() - self.started, 0.001)
        done = self.num_timesteps - self.initial_steps
        return {"status": self.status, "run_id": self.directory.name,
                "steps": done, "model_total_steps": self.num_timesteps,
                "target_steps": self.total, "seed": self.seed,
                "elapsed_seconds": round(elapsed, 2), "steps_per_second": round(done / elapsed, 1),
                "mean_episode_return": round(float(np.mean(self.returns)), 3) if self.returns else None,
                "mean_episode_seconds": round(float(np.mean(self.lengths)) * 0.02, 2) if self.lengths else None,
                "episode_count": self.episode_count,
                "algorithm": "PPO", "device": "cpu", "envs": 4,
                "updated_at": time.time()}

    def _on_training_start(self):
        self.episode_count = 0
        atomic_json(self.directory / "progress.json", self.snapshot())

    def _on_step(self):
        for info in self.locals["infos"]:
            if "episode" in info:
                self.returns.append(info["episode"]["r"])
                self.lengths.append(info["episode"]["l"])
                self.episode_count += 1
        if time.monotonic() - self.last_write > 1:
            atomic_json(self.directory / "progress.json", self.snapshot())
            self.last_write = time.monotonic()
        return not (self.directory / "STOP").exists()

    def _on_rollout_end(self):
        sample = self.snapshot()
        with (self.directory / "history.jsonl").open("a") as handle:
            handle.write(json.dumps(sample) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=65536)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--run-id", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--resume")
    args = parser.parse_args()
    if args.steps < 2048 or Path(args.run_id).name != args.run_id:
        parser.error("steps must be >= 2048; run-id must be a simple directory name")
    directory = ROOT / "runs" / args.run_id
    directory.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    env = DummyVecEnv([lambda: Monitor(Go2Env()) for _ in range(4)])
    if args.resume:
        model = PPO.load(args.resume, env=env, device="cpu")
        model.seed = args.seed
        model.set_random_seed(args.seed)
    else:
        model = PPO("MlpPolicy", env, learning_rate=3e-4, n_steps=512, batch_size=256,
                    n_epochs=5, gamma=0.99, gae_lambda=0.95, ent_coef=0.005,
                    policy_kwargs={"net_arch": [128, 128]}, seed=args.seed, device="cpu", verbose=1)
    callback = Progress(directory, args.steps, args.seed, model.num_timesteps)
    atomic_json(directory / "config.json", {"seed": args.seed, "steps": args.steps,
                "resume": args.resume, "task": "flat_velocity", "control_hz": 50,
                "action_scale": 0.35, "pd_kp": 35.0, "pd_kd": 1.0,
                "randomized_initial_pose": True,
                "command_vx": [0.2, 0.7], "command_vy": [-0.15, 0.15], "command_yaw": [-0.5, 0.5]})
    try:
        model.learn(total_timesteps=args.steps, callback=callback, reset_num_timesteps=not bool(args.resume))
        model.save(directory / "policy")
        callback.status = "evaluating"
        atomic_json(directory / "progress.json", callback.snapshot())
        evaluation = {"policy": evaluate(model), "standing_baseline": evaluate(None),
                      "note": "Same held-out seeds; short runs do not establish walking proficiency."}
        atomic_json(directory / "evaluation.json", evaluation)
        callback.status = "stopped" if (directory / "STOP").exists() else "completed"
        atomic_json(directory / "progress.json", callback.snapshot())
    except BaseException as exc:
        callback.status = "failed"
        status = callback.snapshot()
        status["error"] = repr(exc)
        atomic_json(directory / "progress.json", status)
        raise
    finally:
        env.close()


if __name__ == "__main__":
    main()
