import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { CircleAlert, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_PLUGIN_WHEEL_BYTES, type PluginReleaseManifest, type PluginReleaseUpload, type PluginTestCase } from "../plugin-releases-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { Button } from "./ui/button";

function readFile(file: File, dataUrl = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    if (dataUrl) reader.readAsDataURL(file); else reader.readAsText(file);
  });
}
const jsonArray = (text: string, label: string): unknown[] => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}必须是合法的 JSON。`); }
  if (!Array.isArray(value) || !value.length) throw new Error(`${label}必须是至少包含一项的 JSON 数组。`);
  return value;
};

const emptyIdentity = () => ({ id: "", name: "", version: "", description: "", sdk_version: "1" });
type Draft = { identity: ReturnType<typeof emptyIdentity>; operators: string; cases: string; wheelName: string };
function readDraft(key: string): Draft | null {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (!data || !data.identity || !Object.keys(emptyIdentity()).every((key) => typeof data.identity[key as keyof Draft["identity"]] === "string") || typeof data.operators !== "string" || typeof data.cases !== "string" || typeof data.wheelName !== "string") return null;
    return data;
  } catch { return null; }
}
function ImportedSummary({ text, label }: { text: string; label: string }) {
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { return <p className="plugin-muted">{label} JSON 尚未完成，请在高级编辑中检查。</p>; }
  if (!Array.isArray(rows) || !rows.length) return <p className="plugin-muted">尚未导入{label}。</p>;
  return <div className="plugin-import-summary"><strong>{rows.length} 项{label}</strong><ul>{rows.slice(0, 8).map((row: unknown, index) => <li key={index}>{row && typeof row === "object" && "name" in row && typeof row.name === "string" ? row.name : `第 ${index + 1} 项`}</li>)}</ul>{rows.length > 8 && <small>其余 {rows.length - 8} 项可在高级编辑中查看。</small>}</div>;
}

export function PluginCandidateForm({ open, onOpenChange, pending, error, onSubmit, onDraftChange, draftKey }: {
  open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: Error | null;
  draftKey: string;
  onSubmit: (value: PluginReleaseUpload, interaction?: InteractionContext) => Promise<unknown>;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [restored] = useState(() => readDraft(draftKey));
  const [identity, setIdentity] = useState(restored?.identity ?? emptyIdentity());
  const [operators, setOperators] = useState(restored?.operators ?? "[]");
  const [cases, setCases] = useState(restored?.cases ?? "[]");
  const [wheelName, setWheelName] = useState(restored?.wheelName ?? "");
  const [storageError, setStorageError] = useState(false);
  const [wheel, setWheel] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const [reading, setReading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const busy = pending || reading;
  const dirty = Boolean(wheelName || wheel || identity.id || identity.name || identity.version || identity.description || identity.sdk_version !== "1" || operators !== "[]" || cases !== "[]");
  useEffect(() => { onDraftChange?.(dirty); }, [dirty, onDraftChange]);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ identity, operators, cases, wheelName }));
      else localStorage.removeItem(draftKey);
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [draftKey, dirty, identity, operators, cases, wheelName]);
  useEffect(() => {
    if (!wheel && !busy && !(storageError && dirty)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, wheel, storageError]);
  const clearDraft = () => { setIdentity(emptyIdentity()); setOperators("[]"); setCases("[]"); setWheel(null); setWheelName(""); setLocalError(""); try { localStorage.removeItem(draftKey); } catch { /* Persistence failure is already visible. */ } };
  const closeForm = (discard: boolean) => { if (discard) clearDraft(); setConfirmClose(false); onOpenChange(false); };
  const loadJson = async (file: File | undefined, kind: "manifest" | "tests") => {
    if (!file) return;
    setLocalError("");
    if (file.size > 1024 * 1024) { setLocalError("单个声明或测试文件不能超过 1 MiB。"); return; }
    setReading(true);
    try {
      const text = await readFile(file);
      if (kind === "tests") { jsonArray(text, "测试样例"); setCases(text); }
      else {
        const data = JSON.parse(text) as Partial<PluginReleaseManifest>;
        if (!data || typeof data !== "object" || !Array.isArray(data.operators)) throw new Error("manifest.json 需要包含插件身份和 operators 数组。");
        setIdentity({ id: String(data.id ?? ""), name: String(data.name ?? ""), version: String(data.version ?? ""), description: String(data.description ?? ""), sdk_version: String(data.sdk_version ?? "1") });
        setOperators(JSON.stringify(data.operators, null, 2));
      }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "文件读取失败。"); }
    finally { setReading(false); }
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || busy) return;
    const interaction = interactionForEvent(event.nativeEvent);
    setLocalError(""); lock.current = true; setReading(true);
    try {
      if (!wheel || !wheel.name.endsWith(".whl")) throw new Error("请选择构建完成的 .whl 文件。");
      if (wheel.size > MAX_PLUGIN_WHEEL_BYTES) throw new Error("wheel 文件不能超过 8 MiB。");
      if (![identity.id, identity.name, identity.version].every((value) => value.trim())) throw new Error("请填写插件 ID、名称和版本。");
      const manifest = { ...identity, id: identity.id.trim(), name: identity.name.trim(), version: identity.version.trim(), operators: jsonArray(operators, "算子声明") } as PluginReleaseManifest;
      const testCases = jsonArray(cases, "测试样例") as PluginTestCase[];
      const data = await readFile(wheel, true);
      const input = { wheel_filename: wheel.name, wheel_base64: data.slice(data.indexOf(",") + 1), manifest, test_cases: testCases };
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 12 * 1024 * 1024) throw new Error("候选请求整体不能超过 12 MiB，请减少测试样例体积。");
      await onSubmit(input, interaction);
      clearDraft();
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "候选版本提交失败。"); }
    finally { setReading(false); lock.current = false; }
  }
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy) return; if (!value && dirty) setConfirmClose(true); else onOpenChange(value); }}><Dialog.Portal>
    <Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" />
    <Dialog.Viewport className="fixed inset-0 z-50 plugin-candidate-viewport">
      <Dialog.Popup className="pipe-dialog plugin-upload-dialog plugin-candidate-workspace">
        <div className="pipe-section-heading plugin-candidate-heading"><div><Dialog.Title>新建插件版本</Dialog.Title><Dialog.Description>依次准备文件、检查声明与测试，再上传候选版本。</Dialog.Description></div><Dialog.Close render={<Button size="icon" variant="ghost" disabled={busy} />} aria-label="关闭新建插件版本"><X /></Dialog.Close></div>
        <form className="plugin-upload-form" onSubmit={(event) => void submit(event)}>
          <div className="plugin-candidate-status" role="status">{storageError ? "无法保存浏览器草稿，请保持此页面打开并完成上传。" : "文本草稿自动保存在当前浏览器，按账号和项目隔离；重新打开后需要重选 wheel 文件。"}</div>
          {(localError || error) && <p className="pipe-notice pipe-error plugin-candidate-error" role="alert"><CircleAlert />{localError || error?.message}</p>}
          <nav className="plugin-candidate-steps" aria-label="新建版本步骤"><a href="#plugin-candidate-files">1. 准备文件</a><a href="#plugin-candidate-manifest">2. 检查声明</a><a href="#plugin-candidate-tests">3. 检查测试</a></nav>
          <section id="plugin-candidate-files" className="plugin-candidate-section"><h3>1. 准备文件</h3><p>使用开发模板构建 wheel，并导入生成的声明和测试文件。</p>
          <div className="plugin-file-input"><label htmlFor="plugin-wheel">Python wheel · 最大 8 MiB</label><input id="plugin-wheel" type="file" accept=".whl" disabled={busy} onChange={(event) => { const file = event.target.files?.[0] ?? null; setWheel(file); setWheelName(file?.name ?? ""); setLocalError(""); }} />{wheel && <small>{wheel.name} · {(wheel.size / 1024).toFixed(1)} KiB</small>}{!wheel && wheelName && <small className="plugin-file-restore" role="status">请重新选择 {wheelName}；浏览器只恢复了文件名，文件内容未保存。</small>}</div>
          <div className="plugin-file-input"><label htmlFor="plugin-manifest-file">导入 manifest.json</label><input id="plugin-manifest-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void loadJson(event.target.files?.[0], "manifest")} /><small>导入后可修改下面的声明；服务端会核对实际插件与声明是否一致。</small></div>
          <div className="plugin-file-input"><label htmlFor="plugin-tests-file">导入 test_cases.json</label><input id="plugin-tests-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void loadJson(event.target.files?.[0], "tests")} /></div>
          </section>
          <section id="plugin-candidate-manifest" className="plugin-candidate-section"><h3>2. 检查声明</h3><p>核对插件身份与版本。高级声明用于定义包含的算子。</p>
          <div className="plugin-identity-fields">{([ ["id", "插件 ID", "company.video.shot_filter"], ["name", "插件名称", "镜头时长筛选"], ["version", "版本", "1.0.0"], ["sdk_version", "SDK 版本", "1"] ] as const).map(([key, label, placeholder]) => <label key={key}>{label}<input required value={identity[key]} placeholder={placeholder} disabled={busy} onChange={(event) => setIdentity((old) => ({ ...old, [key]: event.target.value }))} /></label>)}</div>
          <label className="plugin-text-field">插件说明<textarea rows={2} value={identity.description} disabled={busy} onChange={(event) => setIdentity((old) => ({ ...old, description: event.target.value }))} /></label>
          <ImportedSummary text={operators} label="算子声明" />
          <details className="plugin-candidate-advanced"><summary>高级编辑：算子声明 JSON</summary><label className="plugin-text-field">算子声明 · operators JSON<textarea className="pipe-code-input" rows={8} spellCheck={false} value={operators} disabled={busy} onChange={(event) => setOperators(event.target.value)} /><small>声明输入输出类型、参数 Schema、默认参数及副作用，不填写 Python 代码。</small></label></details>
          </section>
          <section id="plugin-candidate-tests" className="plugin-candidate-section"><h3>3. 检查测试</h3><p>导入的样例会随版本一起上传，之后可以单独发起验证。</p>
          <ImportedSummary text={cases} label="测试样例" />
          <details className="plugin-candidate-advanced"><summary>高级编辑：测试样例 JSON</summary><label className="plugin-text-field">测试样例 · test_cases JSON<textarea className="pipe-code-input" rows={7} spellCheck={false} value={cases} disabled={busy} onChange={(event) => setCases(event.target.value)} /><small>每个算子至少一个样例，包含 name、operator_id、config、input，以及完整 expected 产物或 expected_error。</small></label></details>
          </section>
          <div className="plugin-form-footer"><span>上传完成后仍需验证和正式发布。</span><Button type="submit" disabled={busy} data-track-id="plugins.release.create" data-track-label="上传候选版本">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{busy ? "正在上传…" : "上传候选版本"}</Button></div>
        </form>
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
    <AlertDialog.Root open={confirmClose} onOpenChange={setConfirmClose}><AlertDialog.Portal>
      <AlertDialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-[60]" />
      <AlertDialog.Viewport className="fixed inset-0 z-[70] grid place-items-center p-4"><AlertDialog.Popup className="pipe-dialog plugin-draft-dialog" initialFocus={continueEditing}>
        <AlertDialog.Title>保留未提交的插件草稿？</AlertDialog.Title>
        <AlertDialog.Description>{storageError ? "当前浏览器无法保存草稿，关闭后仅在此页面保留；请继续编辑并完成上传。" : "声明和测试已保存在当前浏览器，离开页面后可恢复。wheel 文件内容不会持久保存，返回后需要重新选择。"}</AlertDialog.Description>
        <div className="plugin-draft-actions"><Button variant="destructive-text" onClick={() => closeForm(true)}>放弃草稿</Button><AlertDialog.Close render={<Button ref={continueEditing} variant="ghost" />}>继续编辑</AlertDialog.Close><Button variant="ghost" onClick={() => closeForm(false)}>保留并关闭</Button></div>
      </AlertDialog.Popup></AlertDialog.Viewport>
    </AlertDialog.Portal></AlertDialog.Root>
  </Dialog.Root>;
}
