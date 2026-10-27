import { useRouterState, useSearch } from "@tanstack/react-router";

export type OperatorRouteSearch = {
  project_id?: string;
  view?: "development";
  releaseId?: string;
  pluginId?: string;
  q?: string;
  offset?: number;
};

export function useOperatorSearch() {
  return useSearch({ strict: false }) as OperatorRouteSearch;
}

export function useOperatorBasePath(projectId: string) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.startsWith(`/projects/${projectId}/operators`)
    ? `/projects/${projectId}/operators`
    : "/operators";
}
