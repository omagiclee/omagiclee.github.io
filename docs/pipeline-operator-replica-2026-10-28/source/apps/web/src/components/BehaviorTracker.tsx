import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "../auth-context";
import { behavior, canTrackPage, observeBehavior, projectForLocation } from "../telemetry";

export function BehaviorTracker() {
  const { me } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const defaultProjectId = me.scope.type === "project" ? me.scope.id : undefined;
  const projectId = projectForLocation(pathname, search, defaultProjectId);
  const trackedPath = canTrackPage(pathname, me.permissions) ? pathname : "";
  const identity = `${me.actor.id}:${me.user.id}:${me.impersonation.started_at ?? ""}`;
  useEffect(() => {
    behavior.configure(identity, me.csrf_token, defaultProjectId);
    behavior.navigate(trackedPath, projectId);
  }, [identity, me.csrf_token, defaultProjectId, trackedPath, projectId]);
  // Reattach after a real visit/identity change so controls still in the viewport are re-observed.
  // The collector retains its visit through StrictMode's setup/cleanup replay and deduplicates PV/exposure.
  useEffect(() => trackedPath ? observeBehavior() : undefined, [identity, trackedPath, projectId]);
  return null;
}
