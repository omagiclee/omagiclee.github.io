import { Background, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, useViewport, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Boxes, Database, GitBranch, LayoutGrid, Minus, Plus, Scan, Workflow } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { OperatorManifest, PipelineGraph, PipelineNode, PipelineTask } from "../pipelines-api";
import { connectPipelineInput, connectionError, operatorInputPorts } from "../pipeline-graph";
export { connectionError } from "../pipeline-graph";
import { Button } from "./ui/button";
import "@xyflow/react/dist/style.css";

type OperatorNode = Node<{ definition: PipelineNode; manifest?: OperatorManifest; task?: PipelineTask; inspecting: boolean; onSelect: () => void }, "operator">;
const taskLabels: Record<string, string> = { pending: "待执行", queued: "排队中", running: "运行中", succeeded: "已完成", cached: "复用缓存", failed: "失败", skipped: "已跳过", interrupted: "已中断", cancelled: "已取消" };
const mediaTypes: Record<string, string> = { video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引" };

function OperatorCard({ data, selected, isConnectable }: NodeProps<OperatorNode>) {
  const { definition, manifest } = data;
  const ports = Object.entries(operatorInputPorts(manifest));
  return <div className="pipe-canvas-card" data-selected={selected} data-status={data.task?.status}>
    {ports.map(([port, type], index) => <Handle key={port} type="target" position={Position.Top} id={port}
      style={{ left: `${(index + 1) / (ports.length + 1) * 100}%` }} isConnectable={isConnectable}
      role="img" aria-label={`${definition.id} 输入 ${port} ${type}`} />)}
    {manifest?.input_ports && ports.length > 0 && <div className="pipe-canvas-inputs">{ports.map(([port, type]) => <small key={port}>{port} · {mediaTypes[type] ?? type}</small>)}</div>}
    <div className="pipe-canvas-card-heading"><span className={`pipe-node-icon pipe-kind-${manifest?.kind ?? "transform"}`}>{manifest?.kind === "source" ? <Database /> : manifest?.kind === "sink" ? <Boxes /> : <Workflow />}</span><div><strong>{manifest?.name ?? definition.operator}</strong><small>{definition.id} · v{definition.version}</small></div></div>
    <div className="pipe-canvas-card-footer"><span>{mediaTypes[manifest?.output_type ?? ""] ?? manifest?.output_type ?? "未知类型"}</span><button type="button" className="nodrag" aria-label={`${data.inspecting ? "画布检查" : "配置"}节点 ${definition.id}`} aria-pressed={selected} onClick={data.onSelect}>{data.inspecting ? "检查" : "配置"}</button></div>
    {data.task && <div className="pipe-canvas-run-state"><strong>{taskLabels[data.task.status] ?? data.task.status}</strong><small>{data.task.input_count} → {data.task.output_count} 条</small>{data.task.error && <small className="pipe-task-error" title={data.task.error}>{data.task.error}</small>}</div>}
    <Handle type="source" position={Position.Bottom} id="output" isConnectable={isConnectable} role="img" aria-label={`${definition.id} 输出 ${manifest?.output_type ?? "未知"}`} />
  </div>;
}
const nodeTypes = { operator: OperatorCard };

export function layoutPipeline(graph: PipelineGraph, rowHeight = 240): PipelineGraph {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = graph.nodes.find((item) => item.id === id);
    const inputs = Object.values(node?.inputs ?? {}).filter((input) => graph.nodes.some((item) => item.id === input));
    const level = inputs.length ? 1 + Math.max(...inputs.map(depth)) : 0;
    visiting.delete(id); levels.set(id, level); return level;
  };
  const rows = new Map<number, number>();
  return { ...graph, nodes: graph.nodes.map((node) => {
    const level = depth(node.id);
    const column = rows.get(level) ?? 0;
    rows.set(level, column + 1);
    return { ...node, position: { x: column * 290, y: level * rowHeight } };
  }) };
}

interface CanvasProps {
  graph: PipelineGraph; catalog: OperatorManifest[]; selectedNode: string;
    onSelect: (id: string) => void; onChange: (graph: PipelineGraph, recordHistory?: boolean) => void;
  onError: (message: string) => void; readOnly: boolean;
  tasks?: PipelineTask[];
}

function Canvas({ graph, catalog, selectedNode, onSelect, onChange, onError, readOnly, tasks }: CanvasProps) {
  const flow = useReactFlow<OperatorNode>();
  const { zoom } = useViewport();
  const dragging = useRef(false);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const defaults = useMemo(() => layoutPipeline(graph, tasks ? 300 : 240), [graph, tasks]);
  const nodes: OperatorNode[] = graph.nodes.map((node, index) => ({
    id: node.id, type: "operator", position: !tasks && node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y) ? node.position : defaults.nodes[index].position!,
    selected: node.id === selectedNode, data: { definition: node, manifest: catalog.find((operator) => operator.id === node.operator && operator.version === node.version), task: tasks?.find((task) => task.node_id === node.id), inspecting: Boolean(tasks), onSelect: () => onSelect(node.id) },
  }));
  const edges: Edge[] = graph.nodes.flatMap((node) => Object.entries(node.inputs).filter(([, source]) => graph.nodes.some((item) => item.id === source)).map(([port, source]) => ({ id: `${source}:${node.id}:${port}`, source, target: node.id, sourceHandle: "output", targetHandle: port, type: "smoothstep", label: port, selected: selectedEdges.has(`${source}:${node.id}:${port}`), deletable: !readOnly, style: { stroke: "var(--primary)", strokeWidth: 1.6 }, labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 }, labelBgStyle: { fill: "var(--md-sys-color-surface-container-low)" } })));

  return <div className="pipe-reactflow" role="region" aria-label="可视化流程画布">
    <ReactFlow<OperatorNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView={Boolean(tasks)} fitViewOptions={{ padding: .2 }} defaultViewport={{ x: 40, y: 50, zoom: .85 }} minZoom={.15} maxZoom={1.5} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]} onNodeClick={(_, node) => onSelect(node.id)} onNodesChange={(changes) => {
      const selected = changes.find((change) => change.type === "select" && change.selected);
      if (selected && "id" in selected) onSelect(selected.id);
      if (readOnly) return;
      const positions = changes.filter((change) => change.type === "position");
      if (positions.length) {
        const moved = positions.some((change) => { const node = graph.nodes.find((item) => item.id === change.id); return change.position && (change.position.x !== node?.position?.x || change.position.y !== node?.position?.y); });
        if (moved) {
          onChange({ ...graph, nodes: graph.nodes.map((node) => { const change = positions.find((item) => item.id === node.id); return change?.position ? { ...node, position: change.position } : node; }) }, !dragging.current);
          dragging.current = positions.some((change) => change.dragging);
        }
        if (positions.every((change) => !change.dragging)) dragging.current = false;
      }
    }} onEdgesChange={(changes) => {
      if (changes.some((change) => change.type === "select" && change.selected)) onSelect("");
      setSelectedEdges((previous) => { const next = new Set(previous); for (const change of changes) { if (change.type === "select") { if (change.selected) next.add(change.id); else next.delete(change.id); } } return next; });
    }} onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
      if (readOnly) return;
      const nodeIds = new Set(removedNodes.map((node) => node.id));
      const edgeIds = new Set(removedEdges.map((edge) => edge.id));
      onChange({ ...graph, nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => ({ ...node, inputs: Object.fromEntries(Object.entries(node.inputs).filter(([port, source]) => !nodeIds.has(source) && !edgeIds.has(`${source}:${node.id}:${port}`))) })) });
      setSelectedEdges(new Set());
      if (nodeIds.has(selectedNode)) onSelect(graph.nodes.find((node) => !nodeIds.has(node.id))?.id ?? "");
    }} isValidConnection={(connection) => !connectionError(graph, catalog, connection)} onConnect={(connection) => {
      if (readOnly) return;
      const error = connectionError(graph, catalog, connection);
      if (error) { onError(error); return; }
      onError(""); onChange(connectPipelineInput(graph, catalog, connection));
    }} onConnectEnd={(_, state) => { if (!state.isValid && state.fromNode && state.toNode) onError(connectionError(graph, catalog, { source: state.fromNode.id, target: state.toNode.id, targetHandle: state.toHandle?.id }) ?? "无法建立连接。"); }}
      onPaneClick={() => { onError(""); onSelect(""); }} onlyRenderVisibleElements={false} ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "放大画布", "controls.zoomOut.ariaLabel": "缩小画布", "controls.fitView.ariaLabel": "适配全部节点", "controls.interactive.ariaLabel": "切换画布交互", "minimap.ariaLabel": "流程缩略图" }}>
      <Background color="var(--border)" gap={18} size={1} /><Panel position="bottom-left" className="pipe-viewport-controls" role="group" aria-label="画布视图控制"><Button variant="ghost" size="icon" aria-label="放大画布" title="放大画布" disabled={zoom >= 1.5} onClick={() => void flow.zoomIn()}><Plus /></Button><Button variant="ghost" size="icon" aria-label="缩小画布" title="缩小画布" disabled={zoom <= .15} onClick={() => void flow.zoomOut()}><Minus /></Button><Button variant="ghost" size="icon" aria-label="适配全部节点" title="适配全部节点" onClick={() => void flow.fitView()}><Scan /></Button></Panel><MiniMap pannable zoomable nodeColor="var(--accent)" nodeStrokeColor="var(--primary)" maskColor="color-mix(in srgb, var(--muted) 65%, transparent)" />
      <Panel position="top-left" className="pipe-canvas-tools"><span><GitBranch />{tasks ? "运行视图 · 点击节点检查" : readOnly ? "流程视图 · 点击节点检查" : "拖拽节点 · 从端口连线"}</span>{!readOnly && <Button variant="outline" size="sm" onClick={() => { onChange(layoutPipeline(graph)); window.setTimeout(() => void flow.fitView({ padding: .15, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200 }), 40); }}><LayoutGrid />自动排布</Button>}</Panel>
    </ReactFlow>
  </div>;
}

export function PipelineCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
