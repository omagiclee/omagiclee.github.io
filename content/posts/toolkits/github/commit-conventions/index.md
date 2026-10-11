+++
date = '2026-09-06T00:00:00+08:00'
draft = false
isCJKLanguage = true
title = 'Git Commit 规范：提交语义、变更边界与合并校验'
description = '基于 Conventional Commits 与 SemVer，定义提交格式、原子变更、兼容性声明及合并校验，并给出数据平台团队的实施约定。'
categories = ['工程实践']
tags = ['Git', 'Conventional Commits', 'Code Review', 'CI/CD', '数据平台']
featured = false
+++

Commit 规范应同时明确提交语义、变更边界和兼容性影响，为代码评审、回归定位与版本发布提供依据。

本文以 Conventional Commits 1.0.0 为格式基础，结合 Data Flywheel 项目讨论提出实施约定。标准要求与团队策略分别标明；项目策略为建议方案，示例不代表真实提交。

<!--more-->

## 1. 提交格式与语义

Conventional Commits 定义以下结构：type 和 description 必填，scope、破坏性标记、正文及 footer 可选；冒号后须有空格，正文与 footer 分别以空行分隔。新增功能使用 `feat`，缺陷修复使用 `fix`。破坏性变更须通过 `!` 或 `BREAKING CHANGE:` 声明。[[1]](https://www.conventionalcommits.org/en/v1.0.0/)

```text
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

标题概括行为变化，正文解释原因与关键取舍，footer 关联需求、缺陷或迁移记录。例如：

```text
fix(ingestion): prevent duplicate writes on batch retries

网络超时可能触发同一批次重试。
使用 source_id 与 batch_id 作为幂等键，避免重复落盘。

Refs: DP-142
```

以下 type 分类作为**团队约定**；除 `feat`、`fix` 外，扩展类型不由标准强制规定，也不隐含版本升级级别。[[1]](https://www.conventionalcommits.org/en/v1.0.0/)

| Type | 适用范围 |
| --- | --- |
| `feat` | 新增功能 |
| `fix` | 修复已有行为 |
| `refactor` | 重构实现，保持预期行为 |
| `perf` | 保持预期语义的性能改进 |
| `docs` | 文档 |
| `test` | 测试与测试数据 |
| `build` | 构建、打包与构建依赖 |
| `ci` | 持续集成配置 |
| `style` | 不改变语义的代码格式调整 |
| `chore` | 其他维护事项 |
| `revert` | 撤销变更，并关联原提交 |

scope 应采用稳定的业务域或基础模块。跨模块变更可选择共同上层 scope 或省略 scope；提交边界由变更目的决定。UI 变化按实际行为分类：布局缺陷使用 `fix(ui)`，新增主题使用 `feat(ui)`。

## 2. 原子提交与变更边界

按独立目的组织提交，有助于评审、回退和选择性发布。Pro Git 建议将逻辑独立的修改拆分提交，并通过交互式暂存选择变更片段。[[2]](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines)

团队可据此采用三项要求：

- 一次提交完成一个可解释的目的，并包含必要的代码、测试和文档。
- 安全修复、功能开发与工具升级分别提交，保持各自可独立评审。
- 每个提交尽量保持可构建、可验证，避免为满足文件数或 scope 限制拆散完整变更。

提交前检查工作区与暂存区：

```bash
git status --short
git diff
git add -p
git diff --cached
git diff --cached --check
# 运行项目要求且与变更相关的检查
git commit
```

复核范围应覆盖无关修改、凭据和临时文件。AI 生成的消息同样必须与实际暂存内容一致；验证结果与性能收益须有执行记录或测量依据。

## 3. 兼容性声明与版本语义

兼容性以消费者依赖的契约为判断依据。删除字段、改变单位或调整默认行为，均可能要求已有消费者迁移；变更规模不能替代兼容性分析。

```text
feat(dataset)!: standardize capture timestamps in milliseconds

采集协议统一使用整数毫秒，消除字符串时区歧义。
旧版客户端须在接入层完成字段转换。

BREAKING CHANGE: replace capture_time with captured_at_ms.
Refs: DP-208
```

同时使用 `!` 与 `BREAKING CHANGE:` 是本文建议的团队策略；Conventional Commits 允许仅使用其中一种。[[1]](https://www.conventionalcommits.org/en/v1.0.0/)

对于已声明公共 API、采用 SemVer 且版本达到 `1.0.0` 的发布单元，版本语义如下。[[3]](https://semver.org/spec/v2.0.0.html)

| 契约变化 | 版本级别 | 提交信号 |
| --- | --- | --- |
| 向后兼容的缺陷修复 | Patch | `fix` |
| 向后兼容的功能新增 | Minor | `feat` |
| 不兼容的公共 API 变更 | Major | 任意 type 的破坏性标记 |

提交信号与版本级别的映射由 Conventional Commits 说明，实际发布仍需工具执行。[[1]](https://www.conventionalcommits.org/en/v1.0.0/) SemVer 将 `0.y.z` 定义为初始开发阶段。[[3]](https://semver.org/spec/v2.0.0.html) 团队应为该阶段单独约定兼容策略，并在 monorepo 中明确发布单元与包间依赖。

数据平台还应记录结果语义变化：清洗阈值、采样策略和评测口径即使未改变接口，也可能需要回填、重算或重建索引。提交正文说明影响，PR 或设计文档承载消费者清单、兼容窗口、迁移步骤与回滚条件。

## 4. 合并策略与校验对象

提交校验应覆盖最终进入主分支、参与版本分析的消息。GitHub 支持配置 Squash 提交消息的默认来源，包括 PR 标题、描述和提交信息；默认值取决于仓库设置。[[4]](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)

| 合并策略 | 建议校验对象 | 关键要求 |
| --- | --- | --- |
| Squash Merge | PR 标题与最终 Squash 消息 | 保留破坏性声明、迁移入口与需求关联 |
| Rebase Merge／保留全部提交 | 进入主分支的各条提交 | 各提交均满足格式与变更边界要求 |

PR 标题校验只能约束标题，无法保证最终正文完整。职责应明确分配：Commit 记录变更意图，PR 记录方案、验证与迁移风险，Release Notes 记录用户可见影响及升级操作。

## 5. Data Flywheel 实施约定

基于项目讨论，建议采用以下基线：

| 项目 | 约定 |
| --- | --- |
| 标题 | type／scope 小写；英文动词描述，无末尾句号；建议不超过 72 字符，硬上限 100 |
| 正文 | 允许中文；说明原因、影响与必要的验证依据 |
| 业务 scope | `ingestion`、`assets`、`processing`、`search`、`annotation`、`dataset`、`evaluation`、`workflow` |
| 基础 scope | `auth`、`ui`、`infra`、`repo`；按模块演进扩展 |
| 破坏性变更 | 同时使用 `!` 和 `BREAKING CHANGE:`，附迁移入口 |
| 关联信息 | footer 记录需求、缺陷或原提交标识 |
| 合并方式 | 优先 Squash Merge，复核最终提交消息 |

标题语言、长度、scope 集合及双重破坏性标记均为团队策略。实施时固定 commitlint 及预设版本，显式配置 `type-enum`、`scope-case`、`header-max-length` 等规则；双重标记可通过 `breaking-change-exclamation-mark` 检查。[[5]](https://commitlint.js.org/reference/rules.html)

本地 hook 提供提前反馈，CI 检查应设为合并必需条件。格式由工具校验，变更真实性、兼容性与迁移完整性由评审和相关测试确认。

## 6. 提交验收清单

- [ ] 提交围绕单一目的，包含必要的代码、测试和文档。
- [ ] 标题准确表达变化，正文说明必要的原因与影响。
- [ ] 暂存区已复核，无凭据、临时文件或无关修改。
- [ ] 不兼容变更已标记，并提供迁移入口。
- [ ] 相关检查已执行，消息中的验证结论有依据。
- [ ] 最终合并消息保留需求关联与破坏性声明。

发布阶段的制品与部署追溯，参见 [数据平台发布流程与环境管理]({{< relref "/posts/ai-data/data-platform/release-environments/index.md" >}})。

## 参考文献

正文按首次引用顺序编号。规范注明版本；持续更新的在线文档以访问日期为准。以下资料均访问于 **2026-09-06**。

1. Conventional Commits. [*Conventional Commits 1.0.0*](https://www.conventionalcommits.org/en/v1.0.0/). 规范，版本 1.0.0。定位：Specification §§ 1–15；FAQ “How does this relate to SemVer?”。支持提交语法、类型扩展与破坏性标记。
2. Chacon, Scott, and Ben Straub. [*Pro Git*, 2nd ed., § 5.2 “Contributing to a Project”](https://git-scm.com/book/en/v2/Distributed-Git-Contributing-to-a-Project#_commit_guidelines). Git 官方站点在线版。定位：“Commit Guidelines”。支持逻辑拆分、交互式暂存与消息写作实践。
3. Preston-Werner, Tom. [*Semantic Versioning 2.0.0*](https://semver.org/spec/v2.0.0.html). 规范，版本 2.0.0。定位：§§ 1、4–8。支持公共 API 定义、初始开发阶段及版本递增规则。
4. GitHub. [*Configuring commit squashing for pull requests*](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests). GitHub Docs，在线文档。支持 Squash Merge 及默认提交消息配置。
5. commitlint. [*Rules*](https://commitlint.js.org/reference/rules.html). 官方在线文档。定位：`type-enum`、`scope-case`、`header-max-length`、`breaking-change-exclamation-mark`。支持格式校验规则的配置。

**项目资料说明：**Data Flywheel，“设计Commit规范”，内部聊天讨论，未公开；用于第 5 节团队策略，不作为通用规范依据。数据平台示例、结果语义分析与验收清单为结合项目场景形成的工程建议。
