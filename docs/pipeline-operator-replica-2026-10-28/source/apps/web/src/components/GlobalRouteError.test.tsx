import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalRouteError } from "./GlobalRouteError";

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
afterEach(() => { cleanup(); invalidate.mockReset(); });

describe("root route recovery", () => {
  it("invalidates failed loaders before resetting the boundary without navigating away", async () => {
    const reset = vi.fn();
    let resolve!: () => void;
    invalidate.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    render(<GlobalRouteError error={new Error("Failed to fetch")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "暂时无法打开页面" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(screen.getByRole("button", { name: "正在重试" })).toBeDisabled();
    expect(reset).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("keeps recovery available after a retry fails", async () => {
    invalidate.mockRejectedValue(new Error("offline"));
    const reset = vi.fn();
    render(<GlobalRouteError error={new Error("offline")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await screen.findByText("仍无法连接，请稍后重试或刷新页面。");
    expect(screen.getByRole("button", { name: "重新连接" })).toBeEnabled();
    expect(reset).not.toHaveBeenCalled();
  });
});
