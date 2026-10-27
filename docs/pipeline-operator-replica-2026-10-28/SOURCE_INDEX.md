# 源码索引

路径相对于本资料包。source 保留原仓库目录；文件内行为和样式优先于文字概括。

| 文件 | 行数 | 函数及入口 |
| --- | ---: | --- |
| [pages/PipelinesPage.tsx](source/apps/web/src/pages/PipelinesPage.tsx) | 521 | `withDefaultPositions` L45; `usePipelineSearch` L49; `usePipelineBasePath` L52; `downloadJson` L60; `RunStatus` L65; `durationLabel` L68; `ErrorNotice` L75; `OperatorInputFields` L79; `OperatorExecutionHints` L103; `JsonField` L114; `ConfigField` L128; `ResolvedConfigField` L137; `ArtifactPanel` L143; `RunDetail` L157; `PipelinePagination` L205; `useWorkspaceSize` L210; `directoryContext` L224; `PipelineList` L231; `NewPipeline` L251; `VersionsPanel` L269; `PipelineDetail` L278; `PipelineEditor` L308; `PipelinesPage` L498; `ProjectPipelinesRoute` L505; `ProjectPipelinesPage` L511 |
| [pages/OperatorsPage.tsx](source/apps/web/src/pages/OperatorsPage.tsx) | 127 | `operatorSearchText` L35; `operatorCategory` L39; `operatorModalitiesFor` L49; `OperatorsPage` L60; `ProjectOperatorsRoute` L79; `ProjectOperatorLibrary` L85 |
| [components/PipelineCanvas.tsx](source/apps/web/src/components/PipelineCanvas.tsx) | 109 | `OperatorCard` L14; `layoutPipeline` L30; `Canvas` L58; `PipelineCanvas` L107 |
| [pipeline-graph.ts](source/apps/web/src/pipeline-graph.ts) | 50 | `operatorInputPorts` L4; `targetPort` L12; `connectionError` L19; `connectPipelineInput` L45 |
| [pipeline-schema.ts](source/apps/web/src/pipeline-schema.ts) | 46 | `resolveSchema` L4; `mergeSchema` L30; `fieldSchema` L37 |
| [components/PipelineDebugControls.tsx](source/apps/web/src/components/PipelineDebugControls.tsx) | 78 | `ExecutionPlanSummary` L9; `PipelineDebugControls` L20 |
| [components/PipelineDeployments.tsx](source/apps/web/src/components/PipelineDeployments.tsx) | 73 | `PipelineDeployments` L9; `DeploymentContent` L16 |
| [components/TextPipelineTemplate.tsx](source/apps/web/src/components/TextPipelineTemplate.tsx) | 28 | `TextPipelineTemplate` L7 |
| [components/ExecutionSelection.tsx](source/apps/web/src/components/ExecutionSelection.tsx) | 20 | `ExecutionSelection` L7 |
| [components/ArtifactDatasetActions.tsx](source/apps/web/src/components/ArtifactDatasetActions.tsx) | 47 | `ArtifactDatasetActions` L10 |
| [components/TaskProgress.tsx](source/apps/web/src/components/TaskProgress.tsx) | 19 | `TaskProgress` L7 |
| [components/TaskRecordCounts.tsx](source/apps/web/src/components/TaskRecordCounts.tsx) | 11 | `TaskRecordCounts` L5 |
| [components/PluginDevelopmentWorkspace.tsx](source/apps/web/src/components/PluginDevelopmentWorkspace.tsx) | 104 | `ReleaseStatus` L22; `ErrorNotice` L23; `PluginDevelopmentWorkspace` L25; `PluginReleaseDetail` L58; `ValidationBody` L102 |
| [components/PluginCandidateForm.tsx](source/apps/web/src/components/PluginCandidateForm.tsx) | 149 | `readFile` L9; `readDraft` L26; `ImportedSummary` L33; `PluginCandidateForm` L40 |
| [components/PluginValidationReport.tsx](source/apps/web/src/components/PluginValidationReport.tsx) | 37 | `PluginValidationReport` L6 |
| [components/PluginCapabilities.tsx](source/apps/web/src/components/PluginCapabilities.tsx) | 14 | `PluginCapabilities` L7 |
| [components/PluginReleasePagination.tsx](source/apps/web/src/components/PluginReleasePagination.tsx) | 10 | `PluginReleasePagination` L5 |
| [pipelines-api.ts](source/apps/web/src/pipelines-api.ts) | 152 | 类型、请求或样式定义 |
| [plugin-releases-api.ts](source/apps/web/src/plugin-releases-api.ts) | 79 | `downloadPluginTemplate` L73 |
| [deployments-api.ts](source/apps/web/src/deployments-api.ts) | 34 | 类型、请求或样式定义 |
| [operator-route.ts](source/apps/web/src/operator-route.ts) | 21 | `useOperatorSearch` L12; `useOperatorBasePath` L16 |
| [pages/pipelines.css](source/apps/web/src/pages/pipelines.css) | 472 | 类型、请求或样式定义 |
| [pages/plugins.css](source/apps/web/src/pages/plugins.css) | 171 | 类型、请求或样式定义 |

## 配套源码

全局外壳和视觉：`source/apps/web/src/App.tsx`、`App.css`、`fonts.css`、`components/app-shell.css`、`components/ui/`。

路由、项目与权限：`source/apps/web/src/router.tsx`、`auth-context.tsx`、`auth-api.ts`、`components/AppNavigation.tsx`、`components/ProjectContext.tsx`、`components/PermissionRequestButton.tsx`。

后端参考：`source/apps/api/app/` 内为流水线、插件、执行、产物及部署相关模块。这是摘录，缺少完整后端的公共模块和运行环境；不能直接当作独立后端启动。

完整文件清单与 SHA-256：`source-manifest.json`。
