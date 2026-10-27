import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { registerOperatorPlugin, savePipeline, type Pipeline } from "../pipelines-api";
import { Button } from "./ui/button";

export function TextPipelineTemplate({ projectId, csrf, canRegister, onCreated }: { projectId: string; csrf: string; canRegister: boolean; onCreated: (pipeline: Pipeline) => void }) {
  const [text, setText] = useState("用于流水线调试的第一条固定文档\n第二条固定文档");
  const lock = useRef(false);
  const create = useMutation({ mutationFn: async () => {
    const plugin = await registerOperatorPlugin("documents.core", csrf, projectId);
    const source = plugin.operators.find((item) => item.id === "documents.inline");
    const filter = plugin.operators.find((item) => item.id === "documents.filter");
    if (!source || !filter) throw new Error("文本算子尚不可用，请检查服务端版本。");
    const records = text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => ({ id: `sample-${index + 1}`, text: line, metadata: {} }));
    return savePipeline({ name: "文本小样本流水线", description: "固定内联文档 → 文本过滤 → 候选数据集", graph: { nodes: [
      { id: "documents", operator: source.id, version: source.version, config: { ...source.default_config, records }, inputs: {} },
      { id: "filter", operator: filter.id, version: filter.version, config: filter.default_config, inputs: { data: "documents" } },
    ] } }, csrf, undefined, projectId);
  }, onSuccess: onCreated, onSettled: () => { lock.current = false; } });
  return <section className="pipe-template-form"><h2>固定文档 → 文本过滤</h2><p>文档随流水线版本保存。创建后可选择过滤节点进行小样本调试，确认结果后启动正式运行并导入候选数据集。</p>
    <label className="pipe-field"><span>固定输入文档（每行一条）</span><textarea aria-label="固定输入文档" rows={6} value={text} disabled={create.isPending} onChange={(event) => setText(event.target.value)} /></label>
    {create.error && <p className="pipe-task-error" role="alert">{create.error.message}</p>}
    <Button disabled={!canRegister || create.isPending || !text.trim()} onClick={() => { if (lock.current) return; lock.current = true; create.mutate(); }}>{create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}创建文本流程</Button>
    {!canRegister && <p className="pipe-scope-note">创建模板需要算子注册权限。</p>}
    <p className="pipe-scope-note">第一阶段仅支持固定内联文档的小样本调试；媒体流程继续使用正式运行。</p>
  </section>;
}
