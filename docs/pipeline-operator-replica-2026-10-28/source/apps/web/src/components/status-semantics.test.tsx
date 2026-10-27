import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RunStatus } from "../pages/PipelinesPage";
import { Status } from "../pages/platform/shared";
import { ReleaseStatus } from "./PluginDevelopmentWorkspace";

afterEach(cleanup);

it("uses the same failure severity across pipeline runs, plugin validation and training", () => {
  render(<><RunStatus status="failed" /><ReleaseStatus status="validation_failed" /><Status value="训练失败" /></>);
  for (const label of ["失败", "验证未通过", "训练失败"]) {
    expect(screen.getByText(label)).toHaveAttribute("data-variant", "destructive");
  }
});

it("distinguishes a recoverable pause from an active task and a completed task", () => {
  render(<><RunStatus status="running" /><ReleaseStatus status="published" /><Status value="已暂停" /><RunStatus status="cancelled" /></>);
  expect(screen.getByText("运行中")).toHaveAttribute("data-variant", "info");
  expect(screen.getByText("已发布")).toHaveAttribute("data-variant", "success");
  expect(screen.getByText("已暂停")).toHaveAttribute("data-variant", "warning");
  expect(screen.getByText("已取消")).toHaveAttribute("data-variant", "outline");
});
