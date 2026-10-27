export type StageKey = "ingest" | "label" | "train" | "evaluate" | "ship" | "observe";

export interface FlywheelStage {
  key: StageKey;
  name: string;
  status: "running" | "attention" | "healthy";
  count: number;
  detail: string;
}

export interface MetricCard {
  key: string;
  label: string;
  value: string;
  change: string;
  trend: "up" | "down";
}

export interface FlywheelEvent {
  id: string;
  project_id: string;
  stage: StageKey;
  title: string;
  source: string;
  volume: number;
  created_at: string;
}

export interface EventCreateInput {
  stage: StageKey;
  title: string;
  source: string;
  volume: number;
}

export interface Experiment {
  id: string;
  name: string;
  owner: string;
  status: "running" | "evaluating" | "ready";
  progress: number;
  target: string;
}

export interface DashboardData {
  project_id: string;
  generated_at: string;
  stages: FlywheelStage[];
  metrics: MetricCard[];
  events: FlywheelEvent[];
  experiments: Experiment[];
}

export type RequirementStatus = "draft" | "needs_info" | "pending_review" | "pending_schedule" | "in_progress" | "pending_acceptance" | "completed" | "deferred" | "rejected" | "cancelled";
export type RequirementPriority = "low" | "medium" | "high" | "urgent";
export type RequirementCategory = "product" | "data" | "analytics" | "integration";

export interface RequirementActivity {
  id: string;
  action: string;
  from_status: RequirementStatus | null;
  to_status: RequirementStatus;
  comment: string;
  details: Record<string, unknown>;
  actor_name: string;
  created_at: string;
}

export interface Requirement {
  id: string;
  requirement_no: string;
  title: string;
  description: string;
  expected_result: string;
  acceptance_criteria: string;
  category: RequirementCategory;
  priority: RequirementPriority;
  status: RequirementStatus;
  requester_id: string;
  requester_name: string;
  owner_id: string | null;
  owner_name: string | null;
  desired_due_date: string | null;
  committed_due_date: string | null;
  planned_version: string | null;
  delivery_notes: string | null;
  acceptance_notes: string | null;
  created_at: string;
  updated_at: string;
  activities: RequirementActivity[];
  data_spec: DataSpec | null;
  platform_spec: PlatformSpec | null;
  checks: AcceptanceCheck[];
  delivery: RequirementDelivery | null;
  prioritization: Prioritization | null;
  revision: number;
  allowed_actions: string[];
}

export type DataTaskType = "collection" | "curation" | "annotation" | "simulation" | "evaluation" | "platform";
export interface DataSpec {
  task_type: DataTaskType;
  scenario: string;
  modalities: string[];
  quantity: number;
  unit: string;
  source: string;
  target_model: string;
}
export interface AcceptanceCheck { id: string; label: string; operator: "gte" | "lte" | "eq"; target: number; unit: string }
export interface PlatformSpec { module: string; affected_users: string; scope: string; non_goals: string; dependencies: string }
export interface CheckResult { check_id: string; actual: number; evidence: string; source?: string }
export interface DeliveryMetricBinding {check_id:string;source:"quality"|"evaluation";metric:string;slice?:string}
export interface RequirementDelivery {
  dataset_uri: string;
  dataset_version: string;
  report_uri: string;
  model_version: string;
  environment?: string;
  results: CheckResult[];
  dataset_version_id?:string|null;pipeline_run_id?:string|null;experiment_id?:string|null;model_id?:string|null;
  metric_bindings?:DeliveryMetricBinding[];evidence_id?:string|null;provenance?:string;frozen_evidence?:Record<string,unknown>|null;
}
export interface Prioritization { impact: number; urgency: number; confidence: number; effort: number }

export interface RequirementCreateInput {
  title: string;
  description: string;
  expected_result: string;
  acceptance_criteria: string;
  category: RequirementCategory;
  priority: RequirementPriority;
  desired_due_date?: string;
  save_as_draft?: boolean;
  data_spec?: DataSpec | null;
  platform_spec?: PlatformSpec | null;
  checks?: AcceptanceCheck[];
  expected_revision?: number;
}

export interface RequirementTransitionInput {
  action: "submit" | "approve" | "request_changes" | "defer" | "reject" | "schedule" | "deliver" | "accept" | "reject_acceptance" | "resume" | "cancel";
  comment?: string;
  acceptance_criteria?: string;
  owner_id?: string;
  committed_due_date?: string;
  planned_version?: string;
  delivery_notes?: string;
  acceptance_notes?: string;
  expected_revision?: number;
  delivery?: RequirementDelivery;
  prioritization?: Prioritization;
}

export interface Participant { id: string; name: string }
