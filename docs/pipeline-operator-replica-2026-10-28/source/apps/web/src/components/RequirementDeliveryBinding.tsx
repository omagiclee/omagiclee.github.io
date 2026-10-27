import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { apiUrl } from "../auth-api";
import { Input } from "./ui/input";
import type { AcceptanceCheck, RequirementDelivery } from "../types";

type Options = Record<"versions"|"experiments"|"models"|"runs", {id:string;label:string}[]>;
export function RequirementDeliveryBinding({value,onChange,checks}:{value:RequirementDelivery;onChange:(value:RequirementDelivery)=>void;checks:AcceptanceCheck[]}) {
  const {me}=useAuth();
  const options=useQuery({queryKey:["requirement-delivery-options",me.user.id],queryFn:async()=>{const response=await fetch(apiUrl("/api/requirements/delivery-options"),{credentials:"include"});if(!response.ok)throw new Error("读取交付实体需要数据平台查看权限。");return response.json() as Promise<Options>;}});
  const entity=Boolean(value.dataset_version_id || value.experiment_id);
  const update=(key:keyof RequirementDelivery,id:string)=>onChange({...value,[key]:id || null});
  return <fieldset className="req-result-editor"><legend>交付证据来源</legend><p className="text-sm text-muted-foreground">选择平台实体后，验收值由服务器读取并冻结。外部引用保留为未验证的人工证据。生产运行关联由交付负责人声明。</p>{options.error && <p role="alert">{options.error.message}</p>}
    {([['dataset_version_id','versions','已发布数据版本'],['experiment_id','experiments','已完成评测实验'],['model_id','models','固定模型版本'],['pipeline_run_id','runs','成功生产运行']] as const).map(([key,resource,label])=><label className="md-field" key={key}><span className="md-field-label">{label}（选填）</span><select aria-label={label} className="md-select" value={value[key] ?? ""} onChange={event=>update(key,event.target.value)}><option value="">外部引用／未关联</option>{options.data?.[resource].map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label>)}
    {entity && checks.map(check=>{const binding=value.metric_bindings?.find(row=>row.check_id===check.id) ?? {check_id:check.id,source:value.experiment_id ? "evaluation" as const : "quality" as const,metric:value.experiment_id ? "score":"sampleCount",slice:"all"};const change=(patch:Partial<typeof binding>)=>onChange({...value,metric_bindings:[...(value.metric_bindings ?? []).filter(row=>row.check_id!==check.id),{...binding,...patch}]});return <div key={check.id} className="space-y-2"><strong>{check.label} · 冻结指标绑定</strong><select aria-label={`${check.label} 指标来源`} className="md-select" value={binding.source} onChange={event=>change({source:event.target.value as "quality"|"evaluation",metric:event.target.value==="quality"?"sampleCount":"score"})}><option value="quality">数据版本质量报告</option><option value="evaluation">固定评测报告</option></select><label className="md-field"><span className="md-field-label">{check.label} 指标名称</span><Input value={binding.metric} onValueChange={metric=>change({metric})} placeholder={binding.source==="quality"?"sampleCount / issueCount / passed":"score / rmse / mean_iou"}/></label>{binding.source==="evaluation" && <label className="md-field"><span className="md-field-label">{check.label} 场景切片</span><Input value={binding.slice ?? "all"} onValueChange={slice=>change({slice})}/></label>}</div>;})}
  </fieldset>;
}
