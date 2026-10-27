import { describe, expect, it } from "vitest";
import type { OperatorManifest, PipelineGraph } from "../pipelines-api";
import { connectionError, layoutPipeline } from "./PipelineCanvas";
import { connectPipelineInput, operatorInputPorts } from "../pipeline-graph";

const catalog: OperatorManifest[] = [
  { id: "test.source", input_type: null, output_type: "videos" },
  { id: "test.cut", input_type: "videos", output_type: "shots" },
  { id: "test.frame", input_type: "shots", output_type: "frames" },
  { id: "test.label", input_type: "frames", output_type: "frames" },
].map((operator) => ({ ...operator, name: operator.id, version: "1.0.0", plugin_id: "test", description: "UI contract fixture", kind: "transform", config_schema: {}, default_config: {}, deterministic: false, side_effects: false, implementation_digest: "test" }));
const graph: PipelineGraph = { nodes: [
  { id: "source", operator: "test.source", version: "1.0.0", config: {}, inputs: {} },
  { id: "cut", operator: "test.cut", version: "1.0.0", config: {}, inputs: { data: "source" } },
  { id: "frame", operator: "test.frame", version: "1.0.0", config: {}, inputs: { data: "cut" } },
  { id: "label", operator: "test.label", version: "1.0.0", config: {}, inputs: { data: "frame" } },
  { id: "label2", operator: "test.label", version: "1.0.0", config: {}, inputs: { data: "label" } },
] };

describe("pipeline canvas graph invariants", () => {
  it("accepts compatible edges while rejecting source inputs, mismatched types and cycles", () => {
    expect(connectionError(graph, catalog, { source: "source", target: "cut" })).toBeNull();
    expect(connectionError(graph, catalog, { source: "cut", target: "source" })).toContain("不接受上游");
    expect(connectionError(graph, catalog, { source: "source", target: "label" })).toContain("类型不匹配");
    expect(connectionError(graph, catalog, { source: "label", target: "label" })).toContain("自身");
    expect(connectionError(graph, catalog, { source: "label2", target: "label" })).toContain("循环依赖");
  });

  it("requires exact registered operator versions before connecting", () => {
    const otherVersion = { nodes: graph.nodes.map((node) => node.id === "cut" ? { ...node, version: "9.0.0" } : node) };
    expect(connectionError(otherVersion, catalog, { source: "source", target: "cut" })).toContain("注册");
  });

  it("lays out branching graphs without changing data dependencies", () => {
    const branched = { nodes: [...graph.nodes, { ...graph.nodes[2], id: "frame2" }] };
    const layout = layoutPipeline(branched);
    expect(layout.nodes.map(({ position, ...node }) => { expect(Number.isFinite(position?.x)).toBe(true); expect(Number.isFinite(position?.y)).toBe(true); return node; })).toEqual(branched.nodes);
    const frame = layout.nodes.find((node) => node.id === "frame")!;
    const frame2 = layout.nodes.find((node) => node.id === "frame2")!;
    expect(frame.position?.y).toBe(frame2.position?.y);
    expect(frame.position?.x).not.toBe(frame2.position?.x);
  });

  it("checks the selected named input type, exact port, sink restrictions and cycles", () => {
    const merge = { ...catalog[1], id: "test.merge", input_type: null, input_ports: { videos: "videos", shots: "shots" }, output_type: "shots" };
    const namedCatalog = [...catalog, merge, { ...catalog[1], id: "test.sink", kind: "sink" }];
    const namedGraph = { nodes: [...graph.nodes, { id: "merge", operator: merge.id, version: "1.0.0", config: {}, inputs: { videos: "source", shots: "cut" } },
      { id: "downstream", operator: catalog[1].id, version: "1.0.0", config: {}, inputs: { data: "merge" } },
      { id: "sink", operator: "test.sink", version: "1.0.0", config: {}, inputs: { data: "source" } }] };
    expect(connectionError(namedGraph, namedCatalog, { source: "source", target: "merge", targetHandle: "videos" })).toBeNull();
    expect(connectionError(namedGraph, namedCatalog, { source: "cut", target: "merge", targetHandle: "shots" })).toBeNull();
    expect(connectionError(namedGraph, namedCatalog, { source: "cut", target: "merge", targetHandle: "videos" })).toContain("类型不匹配");
    expect(connectionError(namedGraph, namedCatalog, { source: "cut", target: "merge", targetHandle: "data" })).toContain("端口不存在");
    expect(connectionError(namedGraph, namedCatalog, { source: "cut", target: "merge" })).toContain("请选择");
    expect(connectionError(namedGraph, namedCatalog, { source: "downstream", target: "merge", targetHandle: "shots" })).toContain("循环依赖");
    expect(connectionError(namedGraph, namedCatalog, { source: "sink", target: "merge", targetHandle: "shots" })).toContain("不能连接下游");
    expect(operatorInputPorts(catalog[1])).toEqual({ data: "videos" });
    expect(operatorInputPorts({ ...merge, kind: "source" })).toEqual({});
  });

  it("replaces only one input while preserving other ports and ignores invalid connections", () => {
    const merge = { ...catalog[1], id: "test.merge", input_type: null, input_ports: { left: "videos", right: "videos" } };
    const namedCatalog = [...catalog, merge];
    const namedGraph = { nodes: [...graph.nodes, { id: "other", operator: catalog[0].id, version: "1.0.0", config: {}, inputs: {} },
      { id: "merge", operator: merge.id, version: "1.0.0", config: { keep: true }, inputs: { left: "source", right: "source" } }] };
    const result = connectPipelineInput(namedGraph, namedCatalog, { source: "other", target: "merge", targetHandle: "left" });
    expect(result.nodes.at(-1)).toMatchObject({ config: { keep: true }, inputs: { left: "other", right: "source" } });
    expect(namedGraph.nodes.at(-1)?.inputs.left).toBe("source");
    expect(connectPipelineInput(namedGraph, namedCatalog, { source: "cut", target: "merge", targetHandle: "right" })).toBe(namedGraph);
  });
});
