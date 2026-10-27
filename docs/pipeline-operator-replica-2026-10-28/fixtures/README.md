# 样例数据说明

- `operator-catalog.json`：本次临时 demo 项目启用 `media.video` 和 `documents.core` 后由真实开发 API 返回的 10 个算子版本。可用于 UI 初始化与 Schema 表单示例；它不是所有项目固定不变的目录。
- `installed-plugins.json`：临时开发环境中的 3 个预装插件及算子声明、注册状态。插件目录和已启用算子目录范围不同。
- `visual-fixtures.json`：截图脚本为展示发布、验证和运行产物界面构造的合成响应，不是实际 wheel 验证或真实运行记录。失败截图的变体见 `tools/capture.cjs`；该 JSON 保存脚本结束时的通过/已发布变体。

算子 ID、准确版本、config_schema、default_config 和输入输出契约均应从 API adapter 读取。不要只按截图中的 10 张卡片硬编码页面。
