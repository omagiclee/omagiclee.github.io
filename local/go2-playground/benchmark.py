import json
from pathlib import Path
import platform
import subprocess
import time
import numpy as np
import mujoco
import torch
from stable_baselines3.common.env_checker import check_env
from go2_env import Go2Env, ROOT


def main():
    env = Go2Env(randomize=True)
    check_env(env, warn=True)
    first = env.reset(seed=123)[0]
    second = env.reset(seed=123)[0]
    np.testing.assert_array_equal(first, second)
    env.randomize = False
    env.command[:] = 0
    env.reset()
    action = np.zeros(12)
    start = time.perf_counter()
    for _ in range(1000):
        obs, reward, done, truncated, info = env.step(action)
        assert not done, f"Standing reference fell: {info}"
        assert np.isfinite(obs).all() and np.isfinite(reward)
        assert (np.abs(env.data.ctrl) <= np.maximum(np.abs(env.model.actuator_ctrlrange[:, 0]),
                                                    np.abs(env.model.actuator_ctrlrange[:, 1])) + 1e-6).all()
    duration = time.perf_counter() - start
    assert info["height"] > 0.20
    assert -env.body_state()[2][2] > 0.98
    for invalid in (np.full(12, np.nan), np.zeros(11)):
        try:
            env.step(invalid)
            raise AssertionError("Invalid action was accepted")
        except ValueError:
            pass
    def sysctl(key):
        try:
            return subprocess.check_output(["sysctl", "-n", key], text=True, stderr=subprocess.DEVNULL).strip()
        except subprocess.SubprocessError:
            return "unknown"
    report = {"chip": sysctl("machdep.cpu.brand_string"), "memory_bytes": sysctl("hw.memsize"),
              "cpu_cores": sysctl("hw.ncpu"), "architecture": platform.machine(),
              "python": platform.python_version(), "mujoco": mujoco.__version__, "torch": torch.__version__,
              "mps_available": torch.backends.mps.is_available(), "training_device": "cpu",
              "environment_steps_per_second": round(1000 / duration, 1),
              "physics_steps_per_second": round(10000 / duration, 1),
              "simulation_realtime_factor": round(20 / duration, 1),
              "standing_height": round(info["height"], 3), "check_env": "passed",
              "note": "No rendering or PPO updates; training throughput is reported separately."}
    (ROOT / "artifacts").mkdir(exist_ok=True)
    (ROOT / "artifacts/system.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
