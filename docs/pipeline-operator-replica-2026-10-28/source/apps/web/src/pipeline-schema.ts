import type { JsonSchema } from "./pipelines-api";

/** Resolve local JSON pointers for rendering; server validation remains authoritative. */
export function resolveSchema(schema: JsonSchema, root: JsonSchema, seen = new Set<string>()): JsonSchema {
  let resolved = { ...schema };
  if (schema.$ref) {
    const reference = schema.$ref;
    if (!reference.startsWith("#/")) throw new Error("表单仅支持本地 JSON Pointer 引用，请使用 JSON 编辑参数。");
    if (seen.has(reference)) throw new Error("参数包含递归引用，请使用 JSON 编辑参数。");
    let target: unknown = root;
    for (const encoded of reference.slice(2).split("/")) {
      const key = decodeURIComponent(encoded).replace(/~1/g, "/").replace(/~0/g, "~");
      if (!target || typeof target !== "object" || !Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(`无法解析参数引用 ${reference}，请检查插件定义。`);
      }
      target = (target as Record<string, unknown>)[key];
    }
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("参数引用必须指向一个 Schema 对象。");
    const next = new Set(seen); next.add(reference);
    const { $ref: _, ...siblings } = schema;
    resolved = mergeSchema(resolveSchema(target as JsonSchema, root, next), siblings);
  }
  if (resolved.allOf) {
    const { allOf, ...own } = resolved;
    resolved = allOf.reduce((result, item) => mergeSchema(result, resolveSchema(item, root, seen)), own);
  }
  return resolved;
}

function mergeSchema(base: JsonSchema, extra: JsonSchema): JsonSchema {
  return { ...base, ...extra,
    ...(base.properties || extra.properties ? { properties: { ...base.properties, ...extra.properties } } : {}),
    ...(base.required || extra.required ? { required: [...new Set([...(base.required ?? []), ...(extra.required ?? [])])] } : {}),
  };
}

export function fieldSchema(schema: JsonSchema, root: JsonSchema): { schema: JsonSchema; nullable: boolean; type?: string } {
  const resolved = resolveSchema(schema, root);
  const alternatives = (resolved.anyOf ?? resolved.oneOf ?? []).map((item) => resolveSchema(item, root));
  const types = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
  const nullable = types.includes("null") || alternatives.some((item) => item.type === "null");
  const choice = alternatives.find((item) => item.type !== "null");
  const selected = choice ? mergeSchema(resolved, choice) : resolved;
  const type = Array.isArray(selected.type) ? selected.type.find((item) => item !== "null") : selected.type;
  return { schema: selected, nullable, type };
}
