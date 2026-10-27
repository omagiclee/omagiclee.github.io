import "./platform-mock.css";
import "../styles.css";
import { PlatformProvider } from "./platform/platform-store";
import * as Dataset from "./platform/DatasetPages";
import * as Annotation from "./platform/AnnotationPages";
import * as Evaluation from "./platform/EvaluationPages";
import * as Feedback from "./platform/FeedbackPages";

// The page owns its query once. Child dialogs, newly selected tabs, and execution
// panels share that state instead of starting independent Suspense boundaries.
export function DatasetsPage() { return <PlatformProvider><Dataset.DatasetsPage /></PlatformProvider>; }
export function DatasetDetailPage() { return <PlatformProvider><Dataset.DatasetDetailPage /></PlatformProvider>; }
export function AnnotationTasksPage() { return <PlatformProvider><Annotation.AnnotationTasksPage /></PlatformProvider>; }
export function AnnotationTaskDetailPage() { return <PlatformProvider><Annotation.AnnotationTaskDetailPage /></PlatformProvider>; }
export function AnnotationSpecsPage() { return <PlatformProvider><Annotation.AnnotationSpecsPage /></PlatformProvider>; }
export function AnnotationSpecDetailPage() { return <PlatformProvider><Annotation.AnnotationSpecDetailPage /></PlatformProvider>; }
export function EvaluationExperimentsPage() { return <PlatformProvider><Evaluation.EvaluationExperimentsPage /></PlatformProvider>; }
export function EvaluationExperimentDetailPage() { return <PlatformProvider><Evaluation.EvaluationExperimentDetailPage /></PlatformProvider>; }
export function EvaluationBenchmarksPage() { return <PlatformProvider><Evaluation.EvaluationBenchmarksPage /></PlatformProvider>; }
export function EvaluationBenchmarkDetailPage() { return <PlatformProvider><Evaluation.EvaluationBenchmarkDetailPage /></PlatformProvider>; }
export function FeedbackPage() { return <PlatformProvider><Feedback.FeedbackPage /></PlatformProvider>; }
export function FeedbackDetailPage() { return <PlatformProvider><Feedback.FeedbackDetailPage /></PlatformProvider>; }
