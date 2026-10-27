import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PluginReleasePage } from "../plugin-releases-api";
import { Button } from "./ui/button";

export function PluginReleasePagination({ page, offset, pending, onChange, label }: { page?: PluginReleasePage; offset: number; pending: boolean; onChange: (offset: number) => void; label: string }) {
  return <nav className="plugin-release-pagination" aria-label={label}>
    <p aria-live="polite">{page ? page.total ? `第 ${page.offset + 1}–${page.offset + page.items.length} 条，共 ${page.total} 个版本` : "共 0 个版本" : "正在读取版本数量…"}</p>
    <div><Button variant="outline" size="sm" disabled={pending || offset === 0} onClick={() => onChange(Math.max(0, offset - (page?.limit ?? 20)))}><ChevronLeft />上一页</Button><Button variant="outline" size="sm" disabled={pending || !page?.has_more} onClick={() => onChange(offset + (page?.limit ?? 20))}>下一页<ChevronRight /></Button></div>
  </nav>;
}
