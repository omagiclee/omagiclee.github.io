import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectContext } from "./ProjectContext";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate, Link: () => null }));
afterEach(() => { cleanup(); navigate.mockReset(); });

describe("project switching", () => {
  it("shows readable accessible project names and navigates through the router without stale object ids", () => {
    const client = new QueryClient();
    client.setQueryData(["accessible-projects"], { projects: [
      { id: "a", name: "研发项目", permissions: ["pipelines:read"] },
      { id: "b", name: "媒体项目", permissions: ["media:read"] },
    ] });
    render(<QueryClientProvider client={client}><ProjectContext pathname="/pipelines" context={{ label: "当前项目", value: "a", projectId: "a" }} /></QueryClientProvider>);
    expect(screen.getByRole("group", { name: "当前项目：研发项目" })).toContainElement(screen.getByRole("combobox", { name: "切换项目" }));
    expect(screen.getByRole("option", { name: "研发项目" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "切换项目" }), { target: { value: "b" } });
    expect(navigate).toHaveBeenCalledWith({ to: "/projects/b/explore", search: {} });
    client.clear();
  });

  it("retains the current section when the selected project permits it", () => {
    const client = new QueryClient();
    client.setQueryData(["accessible-projects"], { projects: [{ id: "b", name: "另一项目", permissions: ["pipelines:read"] }] });
    render(<QueryClientProvider client={client}><ProjectContext pathname="/operators" context={{ label: "当前项目", value: "a", projectId: "a" }} /></QueryClientProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "切换项目" }), { target: { value: "b" } });
    expect(navigate).toHaveBeenCalledWith({ to: "/projects/b/operators", search: {} });
    client.clear();
  });
  it("omits a selector when the current project is the only accessible option", () => {
    const client = new QueryClient();
    client.setQueryData(["accessible-projects"], { projects: [{ id: "a", name: "研发项目", permissions: ["pipelines:read"] }] });
    const { container } = render(<QueryClientProvider client={client}><ProjectContext pathname="/pipelines" context={{ label: "当前项目", value: "a", projectId: "a" }} /></QueryClientProvider>);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    client.clear();
  });

});
