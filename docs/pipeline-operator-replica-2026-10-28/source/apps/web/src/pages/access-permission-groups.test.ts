import { describe, expect, it } from "vitest";
import type { PermissionDefinition } from "../access-api";
import { groupedPermissions } from "./access-permission-groups";

function permission(key: string, kind: PermissionDefinition["kind"], parent_key: string | null, name = key): PermissionDefinition {
  return { key, kind, parent_key, name, requestable: true, route: null };
}

describe("permission directory grouping", () => {
  it("keeps a deep matching operation under its top-level menu when searching by identifier", () => {
    const permissions = [permission("menu.data:view", "menu", null, "数据平台"), permission("pipelines:read", "page", "menu.data:view", "流水线"), permission("pipelines:run", "button", "pipelines:read", "运行流水线")];
    const groups = groupedPermissions(permissions, "PIPELINES:RUN");
    expect(groups.map(({ name }) => name)).toEqual(["数据平台"]);
    expect(groups[0].rows.map(({ permission }) => permission.key)).toEqual(["pipelines:run"]);
  });

  it("preserves every orphaned or cyclic permission in the other group", () => {
    const permissions = [permission("future:read", "page", "missing:parent"), permission("cycle:a", "button", "cycle:b"), permission("cycle:b", "button", "cycle:a")];
    const groups = groupedPermissions(permissions);
    expect(groups.map(({ name }) => name)).toEqual(["其他权限"]);
    expect(groups[0].rows.map(({ permission }) => permission.key).sort()).toEqual(permissions.map(({ key }) => key).sort());
  });
});
