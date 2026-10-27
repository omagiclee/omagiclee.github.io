import { permissionRows, type PermissionDefinition } from "../access-api";

export function groupedPermissions(permissions: PermissionDefinition[], query = "") {
  const groups = new Map<string, { key: string; name: string; rows: ReturnType<typeof permissionRows> }>();
  const byKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  for (const row of permissionRows(permissions)) {
    if (needle && !`${row.permission.name} ${row.permission.key}`.toLocaleLowerCase("zh-CN").includes(needle)) continue;
    let root = row.permission;
    const seen = new Set([root.key]);
    while (root.parent_key && byKey.has(root.parent_key) && !seen.has(root.parent_key)) {
      seen.add(root.parent_key);
      root = byKey.get(root.parent_key)!;
    }
    const key = root.kind === "menu" ? root.key : "other";
    if (!groups.has(key)) groups.set(key, { key, name: root.kind === "menu" ? root.name : "其他权限", rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}
