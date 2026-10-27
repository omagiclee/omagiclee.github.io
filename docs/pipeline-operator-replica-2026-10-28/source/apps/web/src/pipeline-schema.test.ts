import { describe, expect, it } from "vitest";
import { fieldSchema, resolveSchema } from "./pipeline-schema";
import type { JsonSchema } from "./pipelines-api";

describe("local plugin schemas", () => {
  it("resolves escaped JSON pointers, referenced enums and nullable references", () => {
    const root: JsonSchema = { $defs: {
      "count/value": { type: "integer", minimum: 1, title: "数量" },
      mode: { type: "string", enum: ["fast", "accurate"] },
    } };
    expect(fieldSchema({ $ref: "#/$defs/count~1value" }, root)).toMatchObject({ type: "integer", schema: { minimum: 1, title: "数量" } });
    expect(fieldSchema({ $ref: "#/$defs/mode" }, root).schema.enum).toEqual(["fast", "accurate"]);
    expect(fieldSchema({ anyOf: [{ $ref: "#/$defs/mode" }, { type: "null" }] }, root)).toMatchObject({ type: "string", nullable: true });
  });

  it("resolves root references and exposes allOf properties and required fields", () => {
    const root: JsonSchema = { $defs: { params: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] } }, allOf: [{ $ref: "#/$defs/params" }, { properties: { enabled: { type: "boolean" } } }] };
    expect(resolveSchema(root, root)).toMatchObject({ properties: { count: { type: "integer" }, enabled: { type: "boolean" } }, required: ["count"] });
  });

  it("rejects unresolved, recursive and remote refs without fetching anything", () => {
    const root: JsonSchema = { $defs: { recursive: { $ref: "#/$defs/recursive" } } };
    expect(() => resolveSchema({ $ref: "#/$defs/missing" }, root)).toThrow("无法解析");
    expect(() => resolveSchema({ $ref: "#/$defs/recursive" }, root)).toThrow("递归引用");
    expect(() => resolveSchema({ $ref: "https://example.invalid/schema" }, root)).toThrow("本地");
    expect(() => resolveSchema({ $ref: "#/__proto__/constructor" }, root)).toThrow("无法解析");
  });
});
