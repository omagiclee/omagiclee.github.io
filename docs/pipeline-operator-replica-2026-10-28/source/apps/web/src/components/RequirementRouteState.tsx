import { Link } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, RotateCcw } from "lucide-react";
import { ApiError } from "../auth-api";
import { Button, buttonVariants } from "./ui/button";

export function RequirementLoading() {
  return <main className="md-page"><div className="req-empty" role="status"><LoaderCircle className="size-6 animate-spin text-primary" /><p>正在加载需求…</p></div></main>;
}
export function RequirementError({ error, reset }: { error: unknown; reset: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  return <main className="md-page"><div className="req-empty" role="alert"><AlertCircle className="size-8 text-muted-foreground" /><h1 className="md-page-title">{status === 404 ? "未找到可访问的需求" : status === 403 ? "当前账号没有访问权限" : "暂时无法加载需求"}</h1><p>{status === 404 ? "需求可能不存在，或不属于你可访问的项目范围。" : "请确认服务连接或账号权限后重试。"}</p><div className="flex items-center gap-4"><Button variant="outline" onClick={reset}><RotateCcw />重试</Button><Link className={buttonVariants({ variant: "ghost" })} data-variant="ghost" data-size="default" to="/requirements"><span className="md-button-container md-state-layer">返回需求管理</span></Link></div></div></main>;
}
