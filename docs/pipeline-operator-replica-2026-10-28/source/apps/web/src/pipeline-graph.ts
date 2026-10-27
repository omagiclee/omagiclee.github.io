import type { OperatorManifest, PipelineGraph } from "./pipelines-api";

/** The same port fallback used by backend graph validation and execution. */
export function operatorInputPorts(operator?: OperatorManifest): Record<string, string> {
  if (!operator || operator.kind === "source") return {};
  if (operator.input_ports && Object.keys(operator.input_ports).length) return operator.input_ports;
  return operator.input_type ? { data: operator.input_type } : {};
}

export interface PipelineConnection { source: string | null; target: string | null; targetHandle?: string | null }

function targetPort(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): string | undefined {
  if (connection.targetHandle) return connection.targetHandle;
  const node = graph.nodes.find((item) => item.id === connection.target);
  const ports = Object.keys(operatorInputPorts(catalog.find((item) => item.id === node?.operator && item.version === node?.version)));
  return ports.length === 1 ? ports[0] : undefined;
}

export function connectionError(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): string | null {
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "连接的节点不存在。";
  if (source.id === target.id) return "节点不能连接到自身。";
  const sourceOp = catalog.find((operator) => operator.id === source.operator && operator.version === source.version);
  const targetOp = catalog.find((operator) => operator.id === target.operator && operator.version === target.version);
  if (!sourceOp || !targetOp) return "请先注册节点使用的算子插件。";
  if (sourceOp.kind === "sink") return "数据输出算子不能连接下游节点。";
  const ports = operatorInputPorts(targetOp);
  if (!Object.keys(ports).length) return "数据源算子不接受上游输入。";
  const port = targetPort(graph, catalog, connection);
  if (!port) return "请选择要连接的输入端口。";
  if (!Object.hasOwn(ports, port)) return `输入端口不存在：${port}。`;
  if (sourceOp.output_type !== ports[port]) return `类型不匹配：${sourceOp.output_type} → ${ports[port]}。`;
  const visited = new Set<string>();
  const isUpstream = (id: string): boolean => {
    if (id === target.id) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return Object.values(graph.nodes.find((node) => node.id === id)?.inputs ?? {}).some(isUpstream);
  };
  return isUpstream(source.id) ? "这条连接会形成循环依赖。" : null;
}

/** Replace only the selected port; other inputs and node configuration survive. */
export function connectPipelineInput(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): PipelineGraph {
  const port = targetPort(graph, catalog, connection);
  if (!port || !connection.source || connectionError(graph, catalog, connection)) return graph;
  return { ...graph, nodes: graph.nodes.map((node) => node.id === connection.target
    ? { ...node, inputs: { ...node.inputs, [port]: connection.source! } } : node) };
}
