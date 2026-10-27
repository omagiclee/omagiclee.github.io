import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, Edge, Node, NodeChange } from "@xyflow/react";
import type { OperatorManifest, PipelineGraph } from "../pipelines-api";
import { PipelineCanvas } from "./PipelineCanvas";

const captured = vi.hoisted(() => ({
  props: {} as { onNodesChange: (changes: NodeChange[]) => void; onDelete: (value: { nodes: Node[]; edges: Edge[] }) => void; onConnect: (value: Connection) => void },
  fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoom: .85,
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: typeof captured.props & { children: React.ReactNode }) => { captured.props = props; return props.children; },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  useReactFlow: () => ({ fitView: captured.fitView, zoomIn: captured.zoomIn, zoomOut: captured.zoomOut }),
  useViewport: () => ({ x: 0, y: 0, zoom: captured.zoom }),
  Background: () => null, Controls: () => null, Handle: () => null, MiniMap: () => null, Panel: ({ children, role, "aria-label": label }: { children: React.ReactNode; role?: string; "aria-label"?: string }) => <div role={role} aria-label={label}>{children}</div>,
  Position: { Top: "top", Bottom: "bottom" },
}));
const graph: PipelineGraph = { nodes: [
  { id: "source", operator: "source", version: "1", config: {}, inputs: {}, position: { x: 0, y: 0 } },
  { id: "process", operator: "process", version: "1", config: {}, inputs: { data: "source" }, position: { x: 0, y: 165 } },
] };
const catalog = [{ id: "source", version: "1", kind: "source", input_type: null, output_type: "shots" }, { id: "process", version: "1", kind: "transform", input_type: "shots", output_type: "shots" }] as OperatorManifest[];
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); captured.zoom = .85; });

describe("canvas editing events", () => {
  it("keeps named viewport controls usable in read-only mode and disables zoom at its limits", () => {
    const props = { graph, catalog, selectedNode: "source", onChange: vi.fn(), onSelect: vi.fn(), onError: vi.fn(), readOnly: true };
    const view = render(<PipelineCanvas {...props} />);
    expect(screen.getByRole("group", { name: "画布视图控制" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "适配全部节点" }));
    expect(captured.zoomIn).toHaveBeenCalledOnce();
    expect(captured.zoomOut).toHaveBeenCalledOnce();
    expect(captured.fitView).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
    captured.zoom = 1.5; view.rerender(<PipelineCanvas {...props} />);
    expect(screen.getByRole("button", { name: "放大画布" })).toBeDisabled();
    captured.zoom = .15; view.rerender(<PipelineCanvas {...props} />);
    expect(screen.getByRole("button", { name: "缩小画布" })).toBeDisabled();
  });

  it("respects reduced motion while still arranging and fitting the complete graph", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const onChange = vi.fn();
    render(<PipelineCanvas graph={graph} catalog={catalog} selectedNode="source" onChange={onChange} onSelect={vi.fn()} onError={vi.fn()} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "自动排布" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.any(Array) }));
    await waitFor(() => expect(captured.fitView).toHaveBeenCalledWith({ padding: .15, duration: 0 }));
  });
  it("preserves the viewport when selection changes", () => {
    const props = { graph, catalog, selectedNode: "source", onChange: vi.fn(), onSelect: vi.fn(), onError: vi.fn(), readOnly: false };
    const view = render(<PipelineCanvas {...props} />);
    view.rerender(<PipelineCanvas {...props} selectedNode="process" />);
    expect(captured.fitView).not.toHaveBeenCalled();
  });

  it("records a drag as one undo step even when its first event has not moved", () => {
    let current = graph;
    const changes: boolean[] = [];
    const props = { graph: current, catalog, selectedNode: "source", onSelect: vi.fn(), onError: vi.fn(), readOnly: false,
      onChange: (value: PipelineGraph, record = true) => { current = value; changes.push(record); } };
    const view = render(<PipelineCanvas {...props} />);
    for (const [x, dragging] of [[0, true], [10, true], [20, true], [20, false], [30, true]] as const) {
      captured.props.onNodesChange([{ type: "position", id: "source", position: { x, y: 0 }, dragging }]);
      view.rerender(<PipelineCanvas {...props} graph={current} />);
    }
    expect(changes).toEqual([true, false, true]);
  });

  it("deletes a node and its downstream input through React Flow's onDelete callback", () => {
    const onChange = vi.fn();
    render(<PipelineCanvas graph={graph} catalog={catalog} selectedNode="source" onChange={onChange} onSelect={vi.fn()} onError={vi.fn()} readOnly={false} />);
    captured.props.onDelete({ nodes: [{ id: "source", position: { x: 0, y: 0 }, data: {} }], edges: [] });
    expect(onChange.mock.calls[0][0].nodes).toEqual([{ ...graph.nodes[1], inputs: {} }]);
  });

  it("blocks mutation callbacks in read-only mode", () => {
    const onChange = vi.fn();
    render(<PipelineCanvas graph={graph} catalog={catalog} selectedNode="source" onChange={onChange} onSelect={vi.fn()} onError={vi.fn()} readOnly />);
    captured.props.onDelete({ nodes: [{ id: "source", position: { x: 0, y: 0 }, data: {} }], edges: [] });
    captured.props.onConnect({ source: "source", target: "process", sourceHandle: "output", targetHandle: "data" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("connects and deletes one named port without overwriting the other port", () => {
    const namedGraph = { nodes: [graph.nodes[0], { ...graph.nodes[0], id: "other" },
      { ...graph.nodes[1], inputs: { left: "source", right: "source" } }] };
    const namedCatalog = [catalog[0], { ...catalog[1], input_type: null, input_ports: { left: "shots", right: "shots" } }];
    const onChange = vi.fn(), onError = vi.fn();
    const props = { graph: namedGraph, catalog: namedCatalog, selectedNode: "process", onChange, onError, onSelect: vi.fn(), readOnly: false };
    const view = render(<PipelineCanvas {...props} />);
    captured.props.onConnect({ source: "other", target: "process", sourceHandle: "output", targetHandle: "left" });
    const connected = onChange.mock.calls[0][0] as PipelineGraph;
    expect(connected.nodes[2].inputs).toEqual({ left: "other", right: "source" });
    view.rerender(<PipelineCanvas {...props} graph={connected} />);
    captured.props.onDelete({ nodes: [], edges: [{ id: "other:process:left", source: "other", target: "process", targetHandle: "left" }] });
    expect(onChange.mock.calls[1][0].nodes[2].inputs).toEqual({ right: "source" });
    captured.props.onConnect({ source: "other", target: "process", sourceHandle: "output", targetHandle: "data" });
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("端口不存在"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
