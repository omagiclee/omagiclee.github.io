import { ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { PluginReleaseManifest } from "../plugin-releases-api";
import { buttonVariants } from "./ui/button";

const types: Record<string, string> = { video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引" };
export function PluginCapabilities({ operators, projectId, active = false }: { operators: PluginReleaseManifest["operators"]; projectId: string; active?: boolean }) {
  return <ul className="plugin-capability-list" aria-label="插件包含的算子">{operators.map((operator) => <li key={`${operator.id}@${operator.version}`}>
    <div><strong>{operator.name}</strong><span>v{operator.version}</span></div>
    <p>{operator.description}</p><small>{operator.input_type ? types[operator.input_type] ?? operator.input_type : "源数据"} → {types[operator.output_type] ?? operator.output_type}</small>
    <small>{operator.side_effects ? "包含外部写入" : operator.deterministic ? "支持结果缓存" : "每次重新计算"}</small>
    {active && <Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ view: "new", operator_id: operator.id, operator_version: operator.version }} className={buttonVariants({ size: "sm", variant: "outline" })} data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer">用于新流水线<ArrowRight /></span></Link>}
  </li>)}</ul>;
}
