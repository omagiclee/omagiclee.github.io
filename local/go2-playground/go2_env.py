"""Native MuJoCo Go2 velocity tracking. No scripted gait or pretrained policy."""
from pathlib import Path
import gymnasium as gym
from gymnasium import spaces
import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "vendor/mujoco_menagerie/unitree_go2/scene.xml"


class Go2Env(gym.Env):
    metadata = {"render_modes": ["rgb_array"], "render_fps": 25}

    def __init__(self, randomize=True, max_steps=500):
        super().__init__()
        self.model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
        self.data = mujoco.MjData(self.model)
        self.model.opt.timestep = 0.002
        self.frame_skip = 10
        self.dt = self.model.opt.timestep * self.frame_skip
        self.joints = self.model.actuator_trnid[:, 0]
        self.qadr = self.model.jnt_qposadr[self.joints]
        self.vadr = self.model.jnt_dofadr[self.joints]
        self.home = self.model.key_qpos[0, self.qadr].copy()
        self.base = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "base")
        if self.base < 0:
            raise ValueError("Go2 model is missing body 'base'")
        self.randomize = randomize
        self.max_steps = max_steps
        self.command = np.array([0.4, 0, 0], dtype=np.float64)
        self.previous_action = np.zeros(12)
        self.action_space = spaces.Box(-1.0, 1.0, shape=(12,), dtype=np.float32)
        self.observation_space = spaces.Box(-np.inf, np.inf, shape=(48,), dtype=np.float32)
        self.steps = 0
        self.reset()

    def body_state(self):
        rotation = self.data.xmat[self.base].reshape(3, 3)
        velocity = np.zeros(6)
        mujoco.mj_objectVelocity(self.model, self.data, mujoco.mjtObj.mjOBJ_BODY,
                                self.base, velocity, 1)
        gravity = rotation.T @ np.array([0.0, 0.0, -1.0])
        return velocity[3:].copy(), velocity[:3].copy(), gravity

    def _obs(self):
        linear, angular, gravity = self.body_state()
        return np.concatenate([linear, angular, gravity,
                               self.data.qpos[self.qadr] - self.home,
                               self.data.qvel[self.vadr] * 0.05,
                               self.previous_action, self.command]).astype(np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        mujoco.mj_resetDataKeyframe(self.model, self.data, 0)
        self.steps = 0
        self.previous_action[:] = 0
        if self.randomize:
            self.data.qpos[self.qadr] += self.np_random.uniform(-0.025, 0.025, 12)
            self.command[:] = [self.np_random.uniform(0.2, 0.7),
                               self.np_random.uniform(-0.15, 0.15),
                               self.np_random.uniform(-0.5, 0.5)]
        mujoco.mj_forward(self.model, self.data)
        return self._obs(), {}

    def step(self, action):
        action = np.asarray(action, dtype=np.float64)
        if action.shape != (12,) or not np.isfinite(action).all():
            raise ValueError("Action must contain 12 finite joint offsets")
        action = np.clip(action, -1, 1)
        # Menagerie's Go2 has torque motors, not position actuators. A 500 Hz
        # PD loop translates the policy's 50 Hz joint targets into motor torques.
        target = np.clip(self.home + 0.35 * action,
                         self.model.jnt_range[self.joints, 0],
                         self.model.jnt_range[self.joints, 1])
        for _ in range(self.frame_skip):
            torque = 35.0 * (target - self.data.qpos[self.qadr]) - self.data.qvel[self.vadr]
            self.data.ctrl[:] = np.clip(torque, self.model.actuator_ctrlrange[:, 0],
                                       self.model.actuator_ctrlrange[:, 1])
            mujoco.mj_step(self.model, self.data)
        self.steps += 1
        linear, angular, gravity = self.body_state()
        height = float(self.data.xpos[self.base, 2])
        error = float(np.linalg.norm(linear[:2] - self.command[:2]))
        components = {
            "velocity": 1.5 * float(np.exp(-error ** 2 / 0.25)),
            "yaw": 0.5 * float(np.exp(-(angular[2] - self.command[2]) ** 2 / 0.25)),
            "upright": 0.25 * float(np.clip(-gravity[2], 0, 1)),
            "height": 0.25 * float(np.exp(-(height - 0.28) ** 2 / 0.01)),
            "vertical": -0.15 * float(linear[2] ** 2),
            "roll_pitch": -0.05 * float(np.sum(angular[:2] ** 2)),
            "torque": -0.00002 * float(np.sum(self.data.actuator_force ** 2)),
            "smoothness": -0.02 * float(np.sum((action - self.previous_action) ** 2)),
        }
        finite = np.isfinite(self.data.qpos).all() and np.isfinite(self.data.qvel).all()
        fallen = height < 0.15 or -gravity[2] < 0.45
        terminated = bool(fallen or not finite)
        reward = float(sum(components.values()) - (2.0 if terminated else 0))
        self.previous_action[:] = action
        info = {"height": height, "speed": float(linear[0]), "velocity_error": error,
                "fallen": bool(fallen), "reward_terms": components}
        return self._obs(), reward, terminated, self.steps >= self.max_steps, info

    def close(self):
        pass
