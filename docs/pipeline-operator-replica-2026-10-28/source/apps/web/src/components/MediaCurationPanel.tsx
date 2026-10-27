import { Dialog } from "@base-ui/react/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Download, FolderPlus, Library, LoaderCircle, Play, X } from "lucide-react";
import { useState } from "react";
import { useProjectAuth } from "../auth-context";
import { createMediaCollection, exportMediaCollection, loadMediaCollections, loadSavedMediaSearches, saveMediaSearch, type MediaCollection, type MediaSearchInput } from "../media-api";
import { PermissionRequestButton } from "./PermissionRequestButton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  projectId: string;
  searchId?: string;
  resultCount: number;
  selectedIds: string[];
  disabled: boolean;
  onReplay: (input: MediaSearchInput, name: string) => void;
  onOpenCollection: (collection: MediaCollection) => void;
}

export function MediaCurationPanel({ projectId, searchId, resultCount, selectedIds, disabled, onReplay, onOpenCollection }: Props) {
  const { can, me } = useProjectAuth(projectId);
  const client = useQueryClient();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const saved = useQuery({ queryKey: ["media-saved-searches", projectId], queryFn: () => loadSavedMediaSearches(projectId), enabled: libraryOpen });
  const collections = useQuery({ queryKey: ["media-collections", projectId], queryFn: () => loadMediaCollections(projectId), enabled: libraryOpen });
  const [dialog, setDialog] = useState<"query" | "collection" | null>(null);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"selected" | "results" | "sample">("results");
  const [sampleSize, setSampleSize] = useState(24);
  const [groupBy, setGroupBy] = useState<"video" | "person">("video");
  const [perGroup, setPerGroup] = useState("");
  const [deduplicate, setDeduplicate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function open(kind: "query" | "collection") {
    setDialog(kind); setName(""); setError(""); setNotice("");
    setSource(selectedIds.length ? "selected" : "results");
    setSampleSize(Math.min(resultCount, 24)); setPerGroup(""); setDeduplicate(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!searchId || !name.trim() || busy || !can("media:curate")) return;
    setBusy(true); setError("");
    try {
      if (dialog === "query") {
        await saveMediaSearch(projectId, { name: name.trim(), search_id: searchId }, me.csrf_token);
        await client.invalidateQueries({ queryKey: ["media-saved-searches", projectId] });
        setNotice(`已保存查询「${name.trim()}」，再次运行时将检索最新索引。`);
      } else {
        const collection = await createMediaCollection(projectId, {
          name: name.trim(), search_id: searchId,
          ...(source === "selected" ? { shot_ids: selectedIds } : {}),
          ...(source === "sample" ? { sample: { size: sampleSize, group_by: groupBy, ...(perGroup ? { per_group: Number(perGroup) } : {}), deduplicate } } : {}),
        }, me.csrf_token);
        await client.invalidateQueries({ queryKey: ["media-collections", projectId] });
        setNotice(`已创建「${collection.name}」，固定保存 ${collection.item_count} 个镜头。`);
        onOpenCollection(collection);
      }
      setDialog(null); setLibraryOpen(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function download(collection: MediaCollection) {
    setExporting(collection.id); setError("");
    try { await exportMediaCollection(projectId, collection); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "导出失败，请重试。"); }
    finally { setExporting(""); }
  }

  return <section className="media-curation" aria-label="查询与选集">
    <div className="media-curation-heading">
      <Button variant="ghost" size="sm" aria-expanded={libraryOpen} aria-controls="media-library" onClick={() => setLibraryOpen(!libraryOpen)}><Library />我的查询与选集</Button>
      <div className="media-toolbar-actions">
        <Button variant="outline" size="sm" data-track-id="media.query.save" disabled={disabled || !searchId || !can("media:curate")} onClick={() => open("query")}><Bookmark />保存查询</Button>
        <Button variant="secondary" size="sm" data-track-id="media.collection.create" disabled={disabled || !searchId || !resultCount || !can("media:curate")} onClick={() => open("collection")}><FolderPlus />创建固定选集{selectedIds.length ? ` · ${selectedIds.length} 已选` : ""}</Button>
      </div>
    </div>
    {!can("media:curate") && <PermissionRequestButton projectId={projectId} permission="media:curate" label="申请反馈与选集整理权限" />}
    {notice && <p className="media-success-note" role="status">{notice}</p>}
    {error && !dialog && <p className="media-message media-message-error" role="alert">{error}</p>}
    {libraryOpen && <div id="media-library" className="media-library">
      <div><h3>保存的查询 <span>每次运行获取最新结果</span></h3>
        {saved.isLoading ? <p role="status">正在读取查询…</p> : saved.isError ? <p role="alert">查询读取失败：{saved.error.message}</p> : saved.data?.items.length ? <ul>{saved.data.items.map((item) => <li key={item.id}><span><strong>{item.name}</strong><small>保存时 {item.result_count} 个结果</small></span><Button variant="ghost" size="sm" disabled={!can("media:search") || disabled} onClick={() => onReplay(item.query, item.name)} aria-label={`运行查询 ${item.name}`}><Play />运行</Button></li>)}</ul> : <p>保存常用条件，方便重复检索。</p>}
      </div>
      <div><h3>固定选集 <span>保留创建时的镜头和来源</span></h3>
        {collections.isLoading ? <p role="status">正在读取选集…</p> : collections.isError ? <p role="alert">选集读取失败：{collections.error.message}</p> : collections.data?.items.length ? <ul>{collections.data.items.map((item) => <li key={item.id}><button type="button" className="media-collection-link md-state-layer" onClick={() => onOpenCollection(item)}><strong>{item.name}</strong><small>{item.item_count} 个镜头 · {new Date(item.created_at).toLocaleDateString("zh-CN")}</small></button><Button variant="ghost" size="icon" disabled={Boolean(exporting)} onClick={() => void download(item)} aria-label={`导出选集 ${item.name}`}>{exporting === item.id ? <LoaderCircle className="animate-spin" /> : <Download />}</Button></li>)}</ul> : <p>从已选镜头或当前结果创建可导出的固定选集。</p>}
      </div>
    </div>}
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(opened) => { if (!opened && !busy) setDialog(null); }}>
      <Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"><Dialog.Popup className="media-curation-dialog">
        <div className="media-player-heading"><div><Dialog.Title className="md-headline-small">{dialog === "query" ? "保存查询" : "创建固定选集"}</Dialog.Title><Dialog.Description className="media-player-description">{dialog === "query" ? "保存本次已执行的文字、参考图和筛选条件，之后可重新运行。" : "保存本次检索的镜头快照及来源信息，后续查询变化不会修改它。选集可用于后续标注与数据集发布，尚不代表已审核训练数据。"}</Dialog.Description></div><Dialog.Close render={<Button variant="ghost" size="icon" disabled={busy} />} aria-label="关闭保存窗口"><X /></Dialog.Close></div>
        <form className="media-curation-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="media-curation-fields" disabled={busy}>
          <label className="media-field"><span>名称</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoFocus placeholder={dialog === "query" ? "例如：室内人物短镜头" : "例如：人物镜头评测集 01"} /></label>
          {dialog === "collection" && <>
            <label className="media-field"><span>镜头来源</span><select aria-label="镜头来源" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="selected" disabled={!selectedIds.length}>手动选择 · {selectedIds.length} 个镜头</option><option value="results">本次全部结果 · {resultCount} 个候选</option><option value="sample">从本次结果均衡采样</option></select></label>
            {source === "sample" && <div className="media-sampling-options">
              <label className="media-field"><span>目标镜头数</span><Input type="number" min={1} max={resultCount} value={sampleSize} required onChange={(event) => setSampleSize(Number(event.target.value))} /></label>
              <label className="media-field"><span>均衡维度</span><select aria-label="均衡维度" value={groupBy} onChange={(event) => setGroupBy(event.target.value as "video" | "person")}><option value="video">来源视频</option><option value="person">人物检测状态</option></select></label>
              <label className="media-field"><span>每组最多（可选）</span><Input type="number" min={1} max={resultCount} value={perGroup} onChange={(event) => setPerGroup(event.target.value)} placeholder="不限制" /></label>
              <label className="media-checkbox"><input type="checkbox" checked={deduplicate} onChange={(event) => setDeduplicate(event.target.checked)} />去除重复或近似镜头</label>
              <p className="media-note">按分组轮流选取候选，优先采用相关反馈；自动选取会跳过不相关镜头。去重或配额可能使数量少于目标，这不保证覆盖整个视频库。</p>
            </div>}
            <p className="media-note">候选范围是本次已返回的 {resultCount} 个镜头。自动选取会跳过已标为不相关的镜头；手动选择以你的选择为准。如需更大的选集，请先增加结果数量并重新检索。</p>
          </>}
          </fieldset>
          {error && <p className="media-message media-message-error" role="alert">{error}</p>}
          <div className="media-dialog-actions"><Button variant="ghost" disabled={busy} onClick={() => setDialog(null)}>取消</Button><Button variant="ghost" type="submit" disabled={busy || !name.trim() || !searchId || (dialog === "collection" && source === "selected" && !selectedIds.length)}>{busy && <LoaderCircle className="animate-spin" />}{dialog === "query" ? "确认保存查询" : "确认创建选集"}</Button></div>
        </form>
      </Dialog.Popup></Dialog.Viewport></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
