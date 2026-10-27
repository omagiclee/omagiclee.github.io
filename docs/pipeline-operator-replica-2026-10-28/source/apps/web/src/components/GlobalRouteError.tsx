import { useRouter } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

/** Recover transient root-loader errors without dropping the current deep link. */
export function GlobalRouteError({ reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  async function retry() {
    setRetrying(true);
    setFailed(false);
    try { await router.invalidate(); reset(); }
    catch { setFailed(true); }
    finally { setRetrying(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-6">
    <section className="max-w-lg rounded-2xl bg-[var(--md-sys-color-surface-container-low)] p-8" aria-labelledby="global-error-title">
      <AlertCircle className="mb-4 size-8 text-primary" aria-hidden="true" />
      <h1 id="global-error-title" className="md-page-title">暂时无法打开页面</h1>
      <p className="my-4 text-muted-foreground" role="alert">服务连接可能暂时中断。重试将保留当前页面地址及项目参数。</p>
      <div className="flex flex-wrap gap-3"><Button onClick={() => void retry()} disabled={retrying}>{retrying ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{retrying ? "正在重试" : "重新连接"}</Button><Button variant="outline" onClick={() => window.location.reload()}>刷新页面</Button></div>
      {failed && <p className="mt-4 text-sm text-destructive" role="alert">仍无法连接，请稍后重试或刷新页面。</p>}
    </section>
  </main>;
}
