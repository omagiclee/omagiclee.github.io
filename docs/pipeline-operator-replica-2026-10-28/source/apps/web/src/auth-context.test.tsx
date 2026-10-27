import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { meQueryOptions, type MeResponse } from "./auth-api";

afterEach(cleanup);

describe("permission changes in the active session", () => {
  it("unmounts protected content, cancels old requests and removes cached data before rendering reduced permissions", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const user = { id: "user-1", username: "user", display_name: "测试用户", email: null };
    const me: MeResponse = {
      actor: user, user, scope: { type: "project", id: "demo" }, roles: [], groups: [],
      permissions: ["requirements:read", "requirements:read_all"], can_impersonate: false,
      csrf_token: "token", auth_mode: "dev", impersonation: { active: false, started_at: null, expires_at: null, reason: null },
    };
    client.setQueryData(meQueryOptions.queryKey, me);
    client.setQueryData(["protected-rows"], "所有人的需求");
    client.setQueryData(["access", "notifications"], "此前身份的通知");
    client.setQueryData(["authenticated-user", "project", "other"], { ...me, permissions: ["pipelines:run"] });
    let wasAborted = false;
    let finishOldRequest!: (value: string) => void;
    const staleRequest = client.fetchQuery({ queryKey: ["old-in-flight"], queryFn: ({ signal }) => {
      signal.addEventListener("abort", () => { wasAborted = true; });
      return new Promise<string>((resolve) => { finishOldRequest = resolve; });
    } }).catch(() => undefined);
    const renders: { broad: boolean; data: string | undefined }[] = [];
    function ProtectedContent() {
      const { can } = useAuth();
      const broad = can("requirements:read_all");
      const query = useQuery({ queryKey: ["protected-rows"], queryFn: async () => broad ? "所有人的需求" : "仅我自己的需求" });
      renders.push({ broad, data: query.data });
      return <p>{query.data ?? "正在读取当前权限的数据"}</p>;
    }
    const view = render(<QueryClientProvider client={client}><AuthProvider><ProtectedContent /></AuthProvider></QueryClientProvider>);
    expect(screen.getByText("所有人的需求")).toBeInTheDocument();
    const reducedMe: MeResponse = { ...me, permissions: ["requirements:read"] };
    await act(async () => { client.setQueryData<MeResponse | null>(meQueryOptions.queryKey, reducedMe); });
    await screen.findByText("仅我自己的需求");
    expect(renders.some((item) => !item.broad && item.data === "所有人的需求")).toBe(false);
    expect(client.getQueryData(["access", "notifications"])).toBeUndefined();
    expect(client.getQueryData(["authenticated-user", "project", "other"])).toBeUndefined();
    expect(wasAborted).toBe(true);
    await act(async () => { finishOldRequest("旧身份的迟到响应"); await staleRequest; });
    expect(client.getQueryData(["old-in-flight"])).toBeUndefined();
    expect(client.getQueryData<MeResponse>(meQueryOptions.queryKey)?.permissions).toEqual(["requirements:read"]);
    view.unmount();
    client.clear();
  });
});
