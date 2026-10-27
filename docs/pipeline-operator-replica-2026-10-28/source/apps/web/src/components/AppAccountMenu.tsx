import { Menu } from "@base-ui/react/menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, LoaderCircle, LogOut, ShieldCheck, UserRoundCog } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useAuth } from "../auth-context";
import { apiUrl, logout, meQueryOptions } from "../auth-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { ImpersonationDialog } from "./ImpersonationDialog";
import { Button } from "./ui/button";

export function AppAccountMenu({ projectId }: { projectId?: string }) {
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const [impersonationOpen, setImpersonationOpen] = useState(false);
  const accountStatus = me.impersonation.active ? "代登录" : me.roles?.includes("super_admin") ? "管理员" : undefined;
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const logoutErrorId = useId();
  const logoutMutation = useMutation({
    mutationFn: (interaction?: InteractionContext) => logout(me.csrf_token, interaction),
    onSuccess: ({ redirect_url: redirectUrl }) => {
      queryClient.setQueryData(meQueryOptions.queryKey, null);
      window.location.assign(redirectUrl.startsWith("/") ? apiUrl(redirectUrl) : redirectUrl);
    },
  });

  return (
    <div className="app-account">
      <Menu.Root>
        <Menu.Trigger
          ref={accountTrigger}
          render={<Button variant="ghost" className="app-account-trigger" />}
          aria-label={`账号菜单，${me.user.display_name}`}
        >
          <span className="app-account-avatar" aria-hidden="true">
            {Array.from(me.user.display_name.trim() || me.user.username)[0]?.toUpperCase()}
          </span>
          <span className="app-account-identity">
            <strong title={me.user.display_name}>{me.user.display_name}</strong>
            {accountStatus && <span className="app-account-status">{accountStatus}</span>}
          </span>
          <ChevronDown className="app-account-chevron" aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="app-account-positioner z-40 outline-none" sideOffset={8} align="end">
            <Menu.Popup className="md-account-menu" aria-describedby={logoutMutation.isError ? logoutErrorId : undefined} finalFocus={impersonationOpen ? false : accountTrigger}>
              <div className="app-account-summary">
                <span className="app-account-avatar" aria-hidden="true">{Array.from(me.user.display_name.trim() || me.user.username)[0]?.toUpperCase()}</span>
                <div><strong>{me.user.display_name}</strong><span>@{me.user.username}</span></div>
                {accountStatus && <span className="app-account-status">{accountStatus}</span>}
              </div>
              <Menu.Separator className="app-account-separator" />
              <Menu.Item render={<Link to="/access" search={{ project_id: projectId }} />} className="md-account-menu-item" data-track-id="account.access" data-track-label="我的权限">
                <ShieldCheck aria-hidden="true" /><span><strong>我的权限</strong><small>查看授权与申请记录</small></span>
              </Menu.Item>
              {can("users:impersonate") && !me.impersonation.active && (
                <Menu.Item data-track-id="account.impersonate" data-track-label="打开代登录" className="md-account-menu-item" onClick={() => setImpersonationOpen(true)}>
                  <UserRoundCog aria-hidden="true" />
                  <span><strong>以用户身份进入</strong><small>临时使用目标用户权限</small></span>
                </Menu.Item>
              )}
              <Menu.Item data-track-id="account.logout" data-track-label="退出登录" className="md-account-menu-item" closeOnClick={false} disabled={logoutMutation.isPending} onClick={(event) => logoutMutation.mutate(interactionForEvent(event.nativeEvent))}>
                {logoutMutation.isPending ? <LoaderCircle className="animate-spin" /> : <LogOut aria-hidden="true" />}
                <span><strong>{logoutMutation.isPending ? "正在退出" : "退出登录"}</strong></span>
              </Menu.Item>
            </Menu.Popup>
            {logoutMutation.isError && <p id={logoutErrorId} className="app-account-error md-body-small" role="alert">{logoutMutation.error.message}</p>}
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {can("users:impersonate") && !me.impersonation.active && (
        <ImpersonationDialog open={impersonationOpen} onOpenChange={setImpersonationOpen} finalFocus={accountTrigger} />
      )}
    </div>
  );
}
