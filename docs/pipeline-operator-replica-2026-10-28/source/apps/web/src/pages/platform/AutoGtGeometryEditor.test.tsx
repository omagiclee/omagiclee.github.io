import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtGeometryEditor } from "./AutoGtGeometryEditor";
import type { Sample, Spec } from "./platform-store";
const sample: Sample = { id: "sample", name: "配对", input: "", output: "", label: "", state: "待标注", split: "train", revision: 1, assets: ["input", "target"].map((role) => ({ id: role, kind: "image", sha256: (role === "input" ? "a" : "b").repeat(64), playbackUrl: `/api/data-platform/assets/${role}/playback`, metadata: { role, auto_gt_pair_id: "pair" } })) };
const spec: Spec = { id: "spec", name: "规范", version: "1", type: "图像", labels: ["可用"], instructions: "人工核验", revision: 1 };
function Harness({ readOnly = false }: { readOnly?: boolean }) { const [value, setValue] = useState("{}"); return <><AutoGtGeometryEditor sample={sample} spec={spec} value={value} onChange={setValue} readOnly={readOnly} /><output data-testid="new-geometry">{value}</output></>; }
function load(role: string) { const image = screen.getByRole("img", { name: "可视化标注输入" }); Object.defineProperty(image, "naturalWidth", { configurable: true, value: 100 }); Object.defineProperty(image, "naturalHeight", { configurable: true, value: 80 }); fireEvent.load(image); }
function draw() { const svg = screen.getByRole("img", { name: "几何标注画布" }); vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 160, width: 200, height: 160, toJSON: () => ({}) }); fireEvent.pointerDown(svg, { clientX: 20, clientY: 32, button: 0 }); fireEvent.pointerUp(svg, { clientX: 120, clientY: 96 }); }
beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent)); afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("AutoGT image annotations bind to actual role, bytes and pixel geometry", () => {
  it("does not draw before image load and saves nested image identity on the chosen role", () => {
    render(<Harness />); draw(); expect(screen.getByTestId("new-geometry")).toHaveTextContent("{}"); load("input"); draw(); const first = JSON.parse(screen.getByTestId("new-geometry").textContent!); expect(first.boxes[0].image).toEqual({ assetId: "input", sha256: "a".repeat(64), role: "input", width: 100, height: 80 }); expect(first.boxes[0].width).toBeCloseTo(.5); expect(first.boxes[0].frameMs).toBe(0);
    fireEvent.change(screen.getByLabelText("新标注图像角色"), { target: { value: "target" } }); load("target"); expect(screen.getByRole("img", { name: "几何标注画布" }).querySelectorAll("rect")).toHaveLength(0); draw(); const both = JSON.parse(screen.getByTestId("new-geometry").textContent!); expect(both.boxes).toHaveLength(2); expect(both.boxes[1].image.assetId).toBe("target"); expect(both.boxes[1].image.sha256).toBe("b".repeat(64)); expect(screen.queryByRole("button", { name: "设置片段起点" })).not.toBeInTheDocument();
  });
  it("keeps an independent reviewer canvas read-only without copying frozen diagnostic ROI", () => { render(<Harness readOnly />); load("input"); draw(); expect(screen.getByTestId("new-geometry")).toHaveTextContent("{}"); expect(screen.getByLabelText("AutoGT 图像绘制工具")).toBeDisabled(); });
});
