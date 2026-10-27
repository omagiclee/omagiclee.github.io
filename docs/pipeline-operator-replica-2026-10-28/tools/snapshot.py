"""Copy source files only; never copies .env, databases, credentials or dependencies."""
from pathlib import Path
import hashlib, json, re, shutil, subprocess, sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/omagiclee/Desktop/data-flywheel').resolve()
out = Path(__file__).resolve().parents[1]
entries = []
def copy(rel, category='frontend'):
    src = root / rel
    if not src.is_file():
        raise FileNotFoundError(src)
    dst = out / 'source' / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    data = src.read_bytes()
    dst.write_bytes(data)
    entries.append({'path':str(rel),'category':category,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'lines':data.count(b'\n') if src.suffix not in ('.woff2','.png') else None})

for rel in ['package.json','package-lock.json']:
    copy(Path(rel),'build')
for folder in ['apps/web/src','apps/web/public']:
    for src in sorted((root/folder).rglob('*')):
        if src.is_file() and src.suffix not in ('.tsbuildinfo',) and src.name != '.DS_Store': copy(src.relative_to(root))
for name in ['package.json','pnpm-lock.yaml','index.html','vite.config.ts','vitest.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','playwright.config.ts']:
    copy(Path('apps/web')/name,'build')
for src in sorted((root/'apps/web/e2e').rglob('*')):
    if src.is_file(): copy(src.relative_to(root),'tests')

backend_names = ['pipeline_api','pipeline_runtime','pipeline_models','pipeline_sdk','pipeline_worker','pipeline_plans','pipeline_dataset_api','pipeline_dataset_service','pipeline_dataset_models','pipeline_deployments_api','pipeline_deployments_service','pipeline_deployments_models','pipeline_deployments_worker','plugin_release_api','plugin_release_service','plugin_release_models','plugin_release_adapter','plugin_release_runner','documents_plugin','connection_plugin','media_plugin','media_api','media_models','media_dagster','dagster_definitions','dispatch_worker','dispatch_models','execution_resources','execution_worker_agent','artifact_store']
for name in backend_names: copy(Path('apps/api/app')/(name+'.py'),'backend-reference')
for src in sorted((root/'packages/flywheel-sdk').rglob('*')):
    if src.is_file() and src.suffix in ('.py','.toml','.md') and '__pycache__' not in src.parts: copy(src.relative_to(root),'sdk')
for src in sorted((root/'examples/shot-duration-plugin').rglob('*')):
    if src.is_file() and src.suffix in ('.py','.toml','.md','.json','.sh') and not any(p in ('dist','build','__pycache__') or p.endswith('.egg-info') for p in src.parts): copy(src.relative_to(root),'example')

focused = ['pages/PipelinesPage.tsx','pages/OperatorsPage.tsx','components/PipelineCanvas.tsx','pipeline-graph.ts','pipeline-schema.ts','components/PipelineDebugControls.tsx','components/PipelineDeployments.tsx','components/TextPipelineTemplate.tsx','components/ExecutionSelection.tsx','components/ArtifactDatasetActions.tsx','components/TaskProgress.tsx','components/TaskRecordCounts.tsx','components/PluginDevelopmentWorkspace.tsx','components/PluginCandidateForm.tsx','components/PluginValidationReport.tsx','components/PluginCapabilities.tsx','components/PluginReleasePagination.tsx','pipelines-api.ts','plugin-releases-api.ts','deployments-api.ts','operator-route.ts','pages/pipelines.css','pages/plugins.css']
index=['# 源码索引','', '路径相对于本资料包。source 保留原仓库目录；文件内行为和样式优先于文字概括。','', '| 文件 | 行数 | 函数及入口 |','| --- | ---: | --- |']
for rel in focused:
    p=Path('apps/web/src')/rel
    data=(root/p).read_text()
    names=[]
    for n,line in enumerate(data.splitlines(),1):
        m=re.match(r'(?:export )?(?:default )?(?:async )?function (\w+)\(',line)
        if m: names.append(f'`{m[1]}` L{n}')
    index.append(f'| [{rel}](source/{p}) | {len(data.splitlines())} | '+('; '.join(names) or '类型、请求或样式定义')+' |')
index += ['', '## 配套源码', '', '全局外壳和视觉：`source/apps/web/src/App.tsx`、`App.css`、`fonts.css`、`components/app-shell.css`、`components/ui/`。', '', '路由、项目与权限：`source/apps/web/src/router.tsx`、`auth-context.tsx`、`auth-api.ts`、`components/AppNavigation.tsx`、`components/ProjectContext.tsx`、`components/PermissionRequestButton.tsx`。', '', '后端参考：`source/apps/api/app/` 内为流水线、插件、执行、产物及部署相关模块。这是摘录，缺少完整后端的公共模块和运行环境；不能直接当作独立后端启动。', '', '完整文件清单与 SHA-256：`source-manifest.json`。']
(out/'SOURCE_INDEX.md').write_text('\n'.join(index)+'\n')

# Text-only fallback for AIs that accept a file but cannot unpack an archive.
parts=['# 两个页面的核心完整源码', '', '按原路径分段，内容原样复制。公共 UI、全局样式、字体、完整路由和后端请使用 zip 中的 source；本文件不是独立可运行应用。', '']
for rel in focused:
    p=Path('apps/web/src')/rel
    lang='css' if p.suffix=='.css' else 'tsx' if p.suffix=='.tsx' else 'typescript'
    parts += [f'## {p}', '', f'````{lang}', (root/p).read_text().rstrip(), '````', '']
(out/'CORE_SOURCE.md').write_text('\n'.join(parts))

tests=['pages/PipelineWorkspace.test.tsx','pages/PipelineEditorReview.test.tsx','pages/PipelinesProjectScope.test.tsx','pages/PipelinesRunDetail.test.tsx','pages/PluginDevelopment.test.tsx','components/PipelineCanvas.test.ts','components/PipelineCanvasInteractions.test.tsx','components/PipelineDebugControls.test.tsx','components/PipelineDeployments.test.tsx','components/ArtifactDatasetActions.test.tsx','pipeline-schema.test.ts']
spec=['# 已运行测试的用例索引','','2026-10-28：11 个文件，97 项测试通过。以下标题来自本次执行的文件；`it.each` 等参数化用例可能对应多个执行结果。','']
for rel in tests:
    p=Path('apps/web/src')/rel
    spec += [f'## {rel}', '']
    for n,line in enumerate((root/p).read_text().splitlines(),1):
        m=re.search(r'\b(?:it|test)\(\s*["\x27]([^"\x27]+)',line)
        if m: spec.append(f'- L{n}：{m[1]}')
    spec.append('')
(out/'verification'/'TEST_CASES.md').write_text('\n'.join(spec))
manifest={'snapshot_date':'2026-10-28','timezone':'Asia/Shanghai','source_root':str(root),'source_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'basis':'current working-tree files, including uncommitted changes; not HEAD-only','files':entries}
(out/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':len(entries),'bytes':sum(i['bytes'] for i in entries),'core_source_bytes':(out/'CORE_SOURCE.md').stat().st_size}))
