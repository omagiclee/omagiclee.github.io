# 视频镜头时长插件

这是独立 Python 包，不是应用内置算子。入口 `project.shot_duration` 提供 `project.shot_duration_filter@1.0.0`，输入与输出均为 `shot_assets`。它只筛选传入记录，不下载视频、不调用模型、不读取文件引用、不写数据库。

参数 `min_duration_ms` 默认 1000，`max_duration_ms` 默认 30000，单位都是整数毫秒。镜头时长等于 `end_ms - start_ms`；筛选包含最短和最长边界。顺序、记录 ID、视频 ID、时间边界、文件引用以及制品和记录的其他 metadata 完整保留。空集是合法结果，非法参数或非法镜头边界会报错。

## 包内容

- `pyproject.toml`：包、SDK 依赖与 `data_flywheel.operators` entry point。
- `src/shot_duration_plugin/__init__.py`：参数模型、算子 handler 与插件定义；只引用公共 `flywheel_sdk`，不依赖 `app`。
- `manifest.json`：声明契约，不包含 Python handler、命令或镜像配置。
- `test_cases.json`：平台验证器可直接执行的正常、空集、边界和非法参数测试；成功项用完整 `expected` 制品做严格比较，拒绝项用 `expected_error: {"type": "ValidationError"}` 验证实际异常。
- `tests/test_plugin.py`：实际单元测试，包括非法参数、异常输入、元数据完整性和声明/实现一致性。

测试输入明确标记为 **fixture**：时间边界参照 Big Buck Bunny 的 AutoShot 样例结构，项目/视频/镜头 ID 与引用路径为测试标识，不对应已发布数据，也不需要媒体文件。通过这些测试不能代替真实外部插件在 Dagster 中运行的验收。

## 开发与构建

使用 Python 3.11 或更新版本。平台下载的开发模板在 `sdk/` 内附带与模板匹配的 `data-flywheel-sdk` wheel；先安装该文件和 `setuptools>=77`，不需要访问平台仓库内部路径，也不假设公共 PyPI 已发布同名包。

在包目录执行：

```sh
python -m pip install sdk/data_flywheel_sdk-1.0.0-py3-none-any.whl
python -m pip install --no-deps --no-build-isolation -e .
python -m unittest discover -s tests -v
python -m pip wheel --no-deps --no-build-isolation --wheel-dir dist .
```

`--no-deps` 不会安装缺失 SDK；请先准备 SDK 及其 Pydantic 依赖。`--no-build-isolation` 使用已安装的构建工具，便于离线构建。部署依赖锁与 OCI digest 由平台运行环境管理。

在 Data Flywheel 仓库中，也可使用现有构建环境：

```sh
PYTHONPATH=packages/flywheel-sdk/src:examples/shot-duration-plugin/src .venv/bin/python -m unittest discover -s examples/shot-duration-plugin/tests -v
.venv-media/bin/python scripts/build-shot-duration-plugin.py
.venv-media/bin/python scripts/build-shot-duration-plugin.py --version 1.1.0
```

构建脚本构建本模板 wheel 和公共 SDK wheel，并打包固定开发模板 ZIP，不安装到 API/Dagster、不发布、不运行模型。输出位于本目录 `dist/<version>/`，包含插件 wheel、该版本的 manifest/test cases 和源码 ZIP；源码 ZIP 的 `sdk/` 内包含可直接安装的 SDK wheel。脚本打印插件 wheel 的 SHA-256。当前自包含模板另保存在 `dist/shot-duration-plugin-template-v2.zip` 供平台下载。

脚本默认使用仓库 `.venv/bin/python` 运行 SDK 契约测试，使用调用脚本的 Python 环境构建 wheel；可用 `--test-python` 指定已安装 SDK 依赖的开发解释器。模板测试不需要 Torch 或模型环境。

`--version 1.1.0` 在临时源码副本同时更新 Python 包、插件和算子版本，由实际 SDK 定义生成对应 manifest，执行测试后构建；不修改 1.0.0 源码或产物。第二版保持同样的筛选行为，用于验证版本并存与旧流程复现，不宣称新增业务能力。同一版本目录已有不同内容时构建脚本报错，不覆盖已发布制品。

## 平台提交与真实运行

开发者工作台提交同一 `dist/<version>/` 的 wheel、`manifest.json` 和 `test_cases.json`。成功用例采用完整产物比较，非法参数用例必须实际触发声明的异常类型才算通过。

正式运行须完成平台的验证、发布、环境就绪和项目启用流程，确保运行环境加载同一候选摘要。插件在画布中连接到 AutoShot 下游：`视频接入 → AutoShot → 镜头时长筛选`；也可继续连接关键帧等下游算子。筛选后记录索引可能不连续，来源 ID 与边界保持原样，不重编号、不创建镜头实体。

运行后核对实际输入/输出镜头数、输出时长范围、父制品引用、算子版本及 Dagster Run。该模板的测试记录不是模型、数据库或真实 Dagster 执行成功的证明。
