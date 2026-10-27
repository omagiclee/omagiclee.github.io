import { Link } from "@tanstack/react-router";
import { FileQuestion, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth-context";
import { buttonVariants } from "./ui/button";

export function GlobalRouteNotFound() {
  const { can } = useAuth();
  const destination = can("dashboard:view") ? "/" : "/access";
  return <main className="md-page">
    <section className="mx-auto max-w-lg rounded-2xl bg-[var(--md-sys-color-surface-container-low)] p-8" aria-labelledby="not-found-title">
      <FileQuestion className="mb-4 size-8 text-primary" aria-hidden="true" />
      <h1 id="not-found-title" className="md-page-title">页面不存在</h1>
      <p className="my-4 text-muted-foreground">这个地址没有对应页面，链接可能已变更。请通过导航重新进入所需功能。</p>
      <Link to={destination} className={buttonVariants()} data-variant="default" data-size="default"><span className="md-button-container md-state-layer">{destination === "/" ? "返回概览" : <><ShieldCheck aria-hidden="true" />查看我的权限</>}</span></Link>
    </section>
  </main>;
}
