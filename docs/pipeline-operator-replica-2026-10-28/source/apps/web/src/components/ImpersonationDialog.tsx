import { interactionForEvent, type InteractionContext } from "../telemetry";
import { Dialog } from "@base-ui/react/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";
import { startImpersonation, loadImpersonationTargets } from "../auth-api";
import { useAuth } from "../auth-context";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ImpersonationDialog({ open, onOpenChange, finalFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const { me } = useAuth();
  const [targetUserId, setTargetUserId] = useState("");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [attempted, setAttempted] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const targetGroup = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  const targets = useQuery({
    queryKey: ["impersonation-targets"],
    queryFn: loadImpersonationTargets,
    enabled: open,
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (interaction: InteractionContext | undefined) => startImpersonation({
      target_user_id: targetUserId,
      reason: reason.trim(),
      duration_minutes: durationMinutes,
    }, me.csrf_token, interaction),
    onSuccess: () => {
      window.location.reload();
    },
  });

  const selected = targets.data?.find((target) => target.id === targetUserId);
  const needle = search.trim().toLocaleLowerCase("zh-CN");
  const visibleTargets = targets.data?.filter((target) => [target.display_name, target.username, ...target.groups]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(needle))) ?? [];
  const targetError = attempted && !selected ? "请选择要进入的用户账号。" : "";
  const reasonError = attempted && reason.trim().length < 10 ? "请填写至少 10 个字符的代登录原因，也可以选择下方的常用原因。" : "";

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (mutation.isPending) return;
      onOpenChange(nextOpen);
      if (!nextOpen) { mutation.reset(); setAttempted(false); }
    }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <Dialog.Popup className="md-dialog" initialFocus={searchInput} finalFocus={finalFocus}>
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
              <div>
                <Dialog.Title className="md-headline-small">以此用户身份进入</Dialog.Title>
                <Dialog.Description className="md-body-medium mt-1 text-muted-foreground">
                  临时按目标用户的实际权限使用平台，所有操作都会保留实际操作者。
                </Dialog.Description>
              </div>
              <Dialog.Close render={<Button variant="ghost" size="icon" disabled={mutation.isPending} />} aria-label="关闭">
                <X className="size-5" />
              </Dialog.Close>
            </div>

            <form className="space-y-5 px-6 py-5" aria-busy={mutation.isPending} onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              setAttempted(true);
              if (!selected) {
                const firstChoice = targetGroup.current?.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)');
                (firstChoice ?? searchInput.current)?.focus();
                return;
              }
              if (reason.trim().length < 10) { reasonInput.current?.focus(); return; }
              mutation.mutate(interactionForEvent(event.nativeEvent));
            }}>
              <fieldset>
                <legend className="md-label-large mb-3">选择目标用户</legend>
                <Input ref={searchInput} className="mb-3" aria-label="搜索代登录用户" placeholder="搜索姓名、账号或用户组" value={search} disabled={mutation.isPending} onChange={(event) => setSearch(event.target.value)} />
                {targetError && <p id={`${reasonId}-target-error`} className="md-body-small mb-3 text-destructive" role="alert">{targetError}</p>}
                {targets.isLoading && <p className="md-body-medium flex items-center gap-2 py-4 text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />正在读取用户</p>}
                {targets.isError && <div role="alert"><p className="md-body-medium py-3 text-destructive">{targets.error.message}</p><Button variant="outline" size="sm" disabled={targets.isFetching} onClick={()=>void targets.refetch()}>重新加载用户</Button></div>}
                <div ref={targetGroup} className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="选择目标用户" tabIndex={mutation.isPending ? 0 : -1} aria-disabled={mutation.isPending} aria-invalid={Boolean(targetError)} aria-describedby={targetError ? `${reasonId}-target-error` : undefined}>
                  {visibleTargets.map((target) => {
                    const active = target.id === targetUserId;
                    return (
                      <label key={target.id} className="md-user-option md-selection-control md-state-layer" data-selected={active}>
                        <input type="radio" className="md-user-option-input" name={`${reasonId}-target`} aria-label={`${target.display_name}，账号 ${target.username}`} checked={active} disabled={mutation.isPending} onChange={() => { setTargetUserId(target.id); mutation.reset(); }} />
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-input data-[selected=true]:border-primary data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground" data-selected={active} aria-hidden="true">
                          {active && <Check className="size-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <strong className="md-title-small block [overflow-wrap:anywhere]">{target.display_name}</strong>
                          <span className="md-body-small block text-muted-foreground [overflow-wrap:anywhere]">{target.username}</span>
                          <span className="md-body-small mt-1 block text-muted-foreground">用户组：{target.groups.join("、") || "未加入用户组"}</span>
                          <span className="mt-2 flex flex-wrap gap-1">
                            {target.roles.map((role) => <Badge key={role} variant="secondary">{role}</Badge>)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {targets.isSuccess && visibleTargets.length === 0 && <p className="md-body-medium py-3 text-muted-foreground" role="status">{targets.data.length ? "没有匹配的用户，请尝试其他姓名、账号或用户组。" : "暂无可代登录的用户。"}</p>}
                {selected && <p className="md-body-small mt-3 text-muted-foreground [overflow-wrap:anywhere]">已选择：{selected.display_name}（{selected.username}）</p>}
              </fieldset>

              <div className="md-field">
                <label className="md-field-label" htmlFor={reasonId}>代登录原因</label>
                <textarea
                  ref={reasonInput}
                  id={reasonId}
                  className="md-textarea"
                  value={reason}
                  disabled={mutation.isPending}
                  aria-invalid={Boolean(reasonError)}
                  aria-describedby={`${reasonId}-help${reasonError ? ` ${reasonId}-error` : ""}`}
                  onChange={(event) => { setReason(event.target.value); mutation.reset(); }}
                  placeholder="例如：协助排查项目事件不可见问题"
                  maxLength={240}
                  rows={3}
                />
                <span id={`${reasonId}-help`} className="md-field-supporting">必填，至少 10 个字符，用于审计记录。选择用户后还需填写原因。</span>
                {reasonError && <p id={`${reasonId}-error`} className="md-body-small text-destructive" role="alert">{reasonError}</p>}
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="快捷填写原因">
                  <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={() => { setReason("排查该用户的页面访问和按钮权限"); mutation.reset(); }}>权限排查</Button>
                  <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={() => { setReason("协助排查该用户反馈的平台使用问题"); mutation.reset(); }}>问题协助</Button>
                </div>
              </div>

              <label className="md-field">
                <span className="md-field-label">有效时长</span>
                <select className="md-select" value={durationMinutes} disabled={mutation.isPending} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
                  <option value={5}>5 分钟</option>
                  <option value={15}>15 分钟</option>
                  <option value={30}>30 分钟（上限）</option>
                </select>
              </label>

              <div className="flex gap-3 rounded-lg bg-[var(--md-sys-color-warning-container)] p-3 text-[var(--md-sys-color-on-warning-container)]">
                <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <p className="md-body-small">进入后将获得 {selected?.display_name ?? "目标用户"} 的权限与数据范围，不继承管理员权限。</p>
              </div>

              {mutation.isError && <p className="md-body-medium text-destructive" role="alert">{mutation.error.message}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Dialog.Close render={<Button variant="ghost" disabled={mutation.isPending} />}>取消</Dialog.Close>
                <Button variant="ghost" data-track-id="auth.impersonation.start" data-track-label="开始代登录" type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
                  {mutation.isPending && <LoaderCircle className="animate-spin" />}
                  {mutation.isPending ? "正在切换…" : "确认进入"}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
