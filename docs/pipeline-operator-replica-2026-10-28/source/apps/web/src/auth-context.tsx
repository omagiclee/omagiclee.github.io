import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LogIn, RotateCw } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { apiUrl, meQueryOptions, projectMeQueryOptions, type MeResponse } from "./auth-api";
import { buttonVariants } from "./components/ui/button";
import { cn } from "./lib/utils";

interface AuthContextValue {
  me: MeResponse;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function LoginScreen() {
  const returnTo = `${window.location.pathname}${window.location.search}`;

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-md rounded-[28px] bg-card px-8 py-12 text-center shadow-[var(--md-sys-elevation-level-1)]" aria-labelledby="login-title">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <RotateCw className="size-7" aria-hidden="true" />
        </span>
        <h1 id="login-title" className="md-page-title mt-6">Data Flywheel</h1>
        <p className="md-body-medium mt-2 text-muted-foreground">登录后进入数据闭环控制台</p>
        <a
          className={cn(buttonVariants(), "mt-8 w-full")}
          href={apiUrl(`/auth/login?return_to=${encodeURIComponent(returnTo)}`)}
         data-variant="default" data-size="default"><span className="md-button-container md-state-layer">
          <LogIn />登录平台
        </span></a>
      </section>
    </main>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me } = useSuspenseQuery(meQueryOptions);
  const queryClient = useQueryClient();
  const identity = me ? `${me.user.id}:${me.scope.type}:${me.scope.id}:${me.permissions.join(",")}` : "signed-out";
  const [appliedIdentity, setAppliedIdentity] = useState(identity);
  useEffect(() => {
    if (appliedIdentity === identity) return;
    let active = true;
    const filters = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey.length !== 1 || query.queryKey[0] !== meQueryOptions.queryKey[0] };
    void queryClient.cancelQueries(filters).then(() => {
      if (!active) return;
      queryClient.removeQueries(filters);
      setAppliedIdentity(identity);
    });
    return () => { active = false; };
  }, [identity, appliedIdentity, queryClient]);

  if (!me) return <LoginScreen />;
  if (appliedIdentity !== identity) return <main className="md-page" role="status">正在更新访问权限…</main>;

  const permissions = new Set(me.permissions);
  return (
    <AuthContext.Provider value={{ me, can: (permission) => permissions.has(permission) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

/** Omit the project only for pages whose permissions use the session scope. */
export function useProjectAuth(projectId?: string) {
  const session = useAuth();
  const { data } = useSuspenseQuery(projectId ? projectMeQueryOptions(projectId) : meQueryOptions);
  const me = data ?? session.me;
  const permissions = new Set(me.permissions);
  return { me, can: (permission: string) => permissions.has(permission) };
}

export function Can({ permission, children, fallback = null }: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : fallback;
}
