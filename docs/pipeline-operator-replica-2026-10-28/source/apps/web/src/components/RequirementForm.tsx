import "./requirement-form.css";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Database, Plus, Save, Send, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createRequirement, editRequirement, requirementQueryOptions, requirementsQueryOptions } from "../api";
import { useAuth } from "../auth-context";
import { categoryLabels, operatorLabels, priorityLabels, taskLabels } from "../requirements";
import type { AcceptanceCheck, DataSpec, DataTaskType, PlatformSpec, Requirement, RequirementCreateInput } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";

const schema = z.object({
  title: z.string().trim().min(4, "标题至少 4 个字符").max(160),
  description: z.string().trim().max(5000),
  expected_result: z.string().trim().max(3000),
  acceptance_criteria: z.string().trim().max(3000),
  category: z.enum(["product", "data", "analytics", "integration"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  desired_due_date: z.string(),
});
type Values = z.infer<typeof schema>;
const modalityOptions = ["视频", "图像", "深度", "点云", "动作 / 轨迹", "文本", "音频"];
const templateDescriptions: Record<DataTaskType, string> = {
  collection: "真实场景、多模态与长尾数据", curation: "去重、场景挖掘与高价值筛选", annotation: "时序、动作与多视角标注", simulation: "仿真环境与合成轨迹", evaluation: "固定评测集与模型效果", platform: "工具、服务与平台集成",
};
function templateChecks(type: DataTaskType): AcceptanceCheck[] {
  const metric: Record<DataTaskType, [string, number, string]> = {
    collection: ["有效视频片段数", 1000, "段"], curation: ["有效样本数", 1000, "条"], annotation: ["标注审核通过率", 98, "%"], simulation: ["有效仿真轨迹数", 1000, "条"], evaluation: ["评测场景覆盖率", 95, "%"], platform: ["验收用例通过率", 100, "%"],
  };
  const [label, target, unit] = metric[type];
  return [{ id: crypto.randomUUID(), label, operator: "gte", target, unit }];
}

export function RequirementForm({ requirement: currentRequirement, existing = [], onClose }: { requirement?: Requirement; existing?: Requirement[]; onClose: () => void }) {
  const [requirement] = useState(currentRequirement);
  const contractLocked = Boolean(requirement?.activities.some((item) => item.action === "approve"));
  const { me } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: {
    title: requirement?.title ?? "", description: requirement?.description ?? "", expected_result: requirement?.expected_result ?? "",
    acceptance_criteria: requirement?.acceptance_criteria ?? "", category: requirement?.category ?? "data", priority: requirement?.priority ?? "medium", desired_due_date: requirement?.desired_due_date ?? "",
  } });
  const [spec, setSpec] = useState<DataSpec>(requirement?.data_spec ?? { task_type: requirement ? "platform" : "collection", scenario: "", modalities: [], quantity: 1000, unit: "段", source: "", target_model: "" });
  const [platformSpec, setPlatformSpec] = useState<PlatformSpec>(requirement?.platform_spec ?? { module: "", affected_users: "", scope: "", non_goals: "", dependencies: "" });
  const platform = spec.task_type === "platform";
  const [checks, setChecks] = useState<AcceptanceCheck[]>(requirement?.checks ?? templateChecks("collection"));
  const [dataChecks, setDataChecks] = useState<AcceptanceCheck[]>(platform ? templateChecks("collection") : checks);
  const [platformChecks, setPlatformChecks] = useState<AcceptanceCheck[]>(platform ? checks : []);
  const [templateDefaults, setTemplateDefaults] = useState(!requirement);
  const [validationError, setValidationError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldPrefix = useId();
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; form.setFocus("title"); }, [form]);
  const closeForm = () => { onClose(); returnFocus.current?.focus(); };
  const errorFor = (key: string) => fieldErrors[key] || form.formState.errors[key as keyof Values]?.message;
  const errorProps = (key: string) => ({ id: `${fieldPrefix}-${key}`, "aria-invalid": Boolean(errorFor(key)), "aria-describedby": errorFor(key) ? `${fieldPrefix}-${key}-error` : undefined });
  const support = (key: string) => errorFor(key) ? <span id={`${fieldPrefix}-${key}-error`} className="md-field-supporting" data-error="true">{errorFor(key)}</span> : null;
  const mutation = useMutation({
    mutationFn: ({ payload, interaction }: { payload: RequirementCreateInput; interaction?: InteractionContext }) => requirement ? editRequirement(requirement.id, { ...payload, expected_revision: requirement.revision }, me.csrf_token, interaction) : createRequirement(payload, me.csrf_token, interaction),
    onSuccess: async (created) => {
      queryClient.setQueryData(requirementQueryOptions(created.id).queryKey, created);
      await queryClient.invalidateQueries({ queryKey: requirementsQueryOptions.queryKey });
      onClose();
      await navigate({ to: "/requirements/$requirementId", params: { requirementId: created.id } });
    },
  });
  const save = (values: Values, draft: boolean, interaction?: InteractionContext) => {
    const errors: Record<string, string> = {};
    if (!draft) {
      if (values.description.trim().length < 10) errors.description = "请填写至少 10 个字符的背景与问题。";
      if (values.expected_result.trim().length < 4) errors.expected_result = "请填写至少 4 个字符的期望结果。";
      if (platform) {
        if (!platformSpec.module.trim()) errors.module = "请填写功能模块。";
        if (!platformSpec.affected_users.trim()) errors.affected_users = "请填写使用对象。";
        if (!platformSpec.scope.trim()) errors.scope = "请填写功能范围。";
      } else {
        if (!spec.target_model.trim()) errors.target_model = "请填写目标模型或基线版本。";
        if (!spec.source.trim()) errors.source = "请填写数据来源。";
        if (!spec.scenario.trim()) errors.scenario = "请填写场景范围与排除条件。";
        if (!spec.modalities.length) errors.modalities = "请至少选择一种数据模态。";
        if (!Number.isFinite(spec.quantity) || spec.quantity <= 0) errors.quantity = "请输入大于 0 的需求数量。";
        if (!spec.unit.trim()) errors.unit = "请填写计量单位。";
        if (!checks.length) errors.checks = "请添加至少一项验收指标。";
      }
    }
    checks.forEach((check) => {
      if (!check.label.trim()) errors[`check-${check.id}-label`] = "请填写指标名称。";
      if (!Number.isFinite(check.target)) errors[`check-${check.id}-target`] = "请输入有效的目标值。";
      if (!check.unit.trim()) errors[`check-${check.id}-unit`] = "请填写指标单位。";
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setValidationError("请完善标出的字段后重试；未完成的需求也可先保存草稿。");
      requestAnimationFrame(() => { const first = document.getElementById(`${fieldPrefix}-${Object.keys(errors)[0]}`); first?.focus(); first?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
      return;
    }
    setValidationError("");
    mutation.mutate({ interaction, payload: { ...values, desired_due_date: values.desired_due_date || undefined, data_spec: contractLocked ? requirement!.data_spec : platform ? { task_type: "platform", scenario: "", modalities: [], quantity: 0, unit: "", source: "", target_model: "" } : spec, platform_spec: contractLocked ? requirement!.platform_spec : platform ? platformSpec : null, checks: contractLocked ? requirement!.checks : checks, acceptance_criteria: contractLocked ? requirement!.acceptance_criteria : values.acceptance_criteria, save_as_draft: draft } });
  };
  useEffect(() => { if (mutation.isError) errorSummary.current?.focus(); }, [mutation.isError]);
  const changeSpec = <K extends keyof DataSpec>(key: K, value: DataSpec[K]) => setSpec((current) => ({ ...current, [key]: value }));
  const selectTemplate = (type: DataTaskType) => {
    changeSpec("task_type", type);
    form.setValue("category", type === "platform" ? "product" : "data");
    if (type === "platform" && !platform) { setDataChecks(checks); setChecks(platformChecks); }
    else if (type !== "platform" && platform) { setPlatformChecks(checks); setChecks(dataChecks); }
    else if (templateDefaults || !checks.length) setChecks(type === "platform" ? [] : templateChecks(type));
  };
  const platformField = (key: keyof PlatformSpec, label: string, placeholder: string, multiline = false) => <label className="md-field">
    <span className="md-field-label">{label}</span>
    {multiline ? <textarea {...errorProps(key)} aria-label={label} className="md-textarea" rows={3} value={platformSpec[key]} maxLength={key === "scope" ? 3000 : 2000} onChange={(e) => setPlatformSpec({ ...platformSpec, [key]: e.target.value })} placeholder={placeholder} /> : <Input aria-label={label} {...errorProps(key)} value={platformSpec[key]} maxLength={key === "module" ? 160 : 1000} onChange={(e) => setPlatformSpec({ ...platformSpec, [key]: e.target.value })} placeholder={placeholder} />}
    {support(key)}
  </label>;
  const title = form.watch("title");
  const similar = title.trim().length >= 4 ? existing.filter((item) => item.id !== requirement?.id && item.title.includes(title.trim().slice(0, 4))).slice(0, 3) : [];
  const field = (name: keyof Values, label: string, multiline = false, placeholder?: string) => <label className="md-field">
    <span className="md-field-label">{label}</span>
    {multiline ? <textarea aria-label={label} className="md-textarea" rows={3} {...form.register(name)} placeholder={placeholder} {...errorProps(name)} /> : <Input aria-label={label} {...form.register(name)} placeholder={placeholder} {...errorProps(name)} />}
    {support(name)}
  </label>;
  return <Card className="mb-6 req-form">
    <div className="flex items-start justify-between gap-4 px-6 pt-5"><div><h2 className="md-title-large">{requirement ? "完善需求材料" : "提报新需求"}</h2><p className="mt-1 text-sm text-muted-foreground">选择需求方向，说明业务目标，并约定可验证的交付结果。</p></div><Button variant="ghost" size="icon" onClick={closeForm} disabled={mutation.isPending} aria-label="关闭提交表单"><X /></Button></div>
    <CardContent className="pt-6">
      <form onSubmit={form.handleSubmit((values, event) => save(values, Boolean(requirement), interactionForEvent(event?.nativeEvent)))} noValidate aria-busy={mutation.isPending} className="space-y-7">
        {(validationError || mutation.isError) && <p ref={errorSummary} tabIndex={-1} className="text-sm text-destructive" role="alert">{validationError || mutation.error?.message}</p>}
        <fieldset disabled={mutation.isPending} className="min-w-0 space-y-7" onChange={(event) => {
          const input = event.target as HTMLElement;
          const key = input.id.startsWith(`${fieldPrefix}-`) ? input.id.slice(fieldPrefix.length + 1) : input.closest('[role="group"][aria-label="数据模态"]') ? "modalities" : "";
          if (key) setFieldErrors((errors) => { const next = { ...errors }; delete next[key]; return next; });
        }}>
        {currentRequirement && currentRequirement.revision !== requirement?.revision && <p className="req-notice">这条需求已有新动态。你的未提交内容仍保留；保存时会检查冲突。重新打开编辑表单可载入最新内容。</p>}
        {contractLocked && <p className="req-notice">需求规格和验收标准已在评审中锁定，本次可补充背景与目标说明。</p>}
        <fieldset disabled={contractLocked}><legend className="req-section-label"><span>01</span> 需求方向</legend>
          <div className="mb-4 grid grid-cols-2 gap-3" role="group" aria-label="需求方向">
            <button type="button" className="req-template md-state-layer" aria-pressed={!platform} data-track-id="requirements.template.data" data-track-label="选择数据需求" onClick={() => selectTemplate("collection")}><strong>数据需求</strong><small>采集、筛选、标注、仿真与评测数据</small></button>
            <button type="button" className="req-template md-state-layer" aria-pressed={platform} data-track-id="requirements.template.platform" data-track-label="选择平台开发需求" onClick={() => selectTemplate("platform")}><strong>平台开发</strong><small>功能开发、分析报表与系统集成</small></button>
          </div>
          {!platform && <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{Object.entries(taskLabels).filter(([key]) => key !== "platform").map(([key, label]) => <button type="button" className="req-template md-state-layer" aria-pressed={spec.task_type === key} key={key} data-track-id={`requirements.template.${key}`} data-track-label={label} onClick={() => selectTemplate(key as DataTaskType)}><strong>{label}</strong><small>{templateDescriptions[key as DataTaskType]}</small></button>)}</div>}
        </fieldset>
        <fieldset className="grid gap-4 md:grid-cols-2"><legend className="req-section-label"><span>02</span> 背景与目标</legend><div className="md:col-span-2">{field("title", "需求标题", false, platform ? "例如：为任务调度增加失败重试与告警" : "例如：补齐雨夜路口的多视角交互视频")}</div>
          {similar.length > 0 && <div className="req-similar-records rounded-xl bg-muted p-3 text-sm md:col-span-2"><p>相似需求，提报前可先查看：</p><ul>{similar.map((item) => <li key={item.id}><Link className="req-similar-link md-state-layer" to="/requirements/$requirementId" params={{ requirementId: item.id }}>{item.title}</Link></li>)}</ul></div>}
          {field("description", "背景与问题", true, platform ? "谁在使用哪个模块时遇到了什么问题？当前如何处理？" : "模型在什么场景失效？现有数据缺少什么？")}{field("expected_result", "期望结果", true, platform ? "功能上线后，用户能完成什么操作或改善什么指标？" : "本轮数据将支持哪项训练或评测目标？")}
          <label className="md-field"><span className="md-field-label">建议优先级</span><select className="md-select" {...form.register("priority")}>{Object.entries(priorityLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><span className="md-field-supporting">管理员会结合价值、紧迫性与投入确认排期。</span></label>
          <label className="md-field"><span className="md-field-label">期望日期</span><Input type="date" {...form.register("desired_due_date")} /><span className="md-field-supporting">团队承诺日期将在排期后单独显示。</span></label>
          {spec.task_type === "platform" && <label className="md-field"><span className="md-field-label">需求类型</span><select className="md-select" {...form.register("category")}>{Object.entries(categoryLabels).filter(([key]) => key !== "data").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        </fieldset>
        {platform ? <fieldset disabled={contractLocked} className="grid gap-4 md:grid-cols-2"><legend className="req-section-label"><span>03</span> 平台开发规格</legend>
          {platformField("module", "功能模块", "例如任务调度、数据管理、权限管理")}
          {platformField("affected_users", "使用对象", "例如数据运营人员、模型工程师、管理员")}
          <div className="md:col-span-2">{platformField("scope", "功能范围", "列出本次需要支持的操作、业务规则、异常场景与界面变化", true)}</div>
          {platformField("non_goals", "范围外事项（选填）", "明确本次不包含的功能，避免范围歧义", true)}
          {platformField("dependencies", "依赖与约束（选填）", "依赖的接口、系统、权限、安全和性能约束", true)}
        </fieldset> : <>
        <fieldset disabled={contractLocked} className="grid gap-4 md:grid-cols-2"><legend className="req-section-label"><span>03</span> 数据规格</legend>
          <label className="md-field"><span className="md-field-label">目标模型 / 基线版本</span><Input aria-label="目标模型 / 基线版本" {...errorProps("target_model")} value={spec.target_model} onChange={(e) => changeSpec("target_model", e.target.value)} placeholder="例如 World Model v2.1" maxLength={160} />{support("target_model")}</label>
          <label className="md-field"><span className="md-field-label">数据来源</span><Input aria-label="数据来源" {...errorProps("source")} value={spec.source} onChange={(e) => changeSpec("source", e.target.value)} placeholder="已授权采集库、仿真环境或数据集版本" maxLength={1000} />{support("source")}</label>
          <label className="md-field md:col-span-2"><span className="md-field-label">场景范围与排除条件</span><textarea {...errorProps("scenario")} aria-label="场景范围与排除条件" className="md-textarea" rows={3} value={spec.scenario} onChange={(e) => changeSpec("scenario", e.target.value)} placeholder="场景分布、时序长度、分辨率、同步要求、交付格式与排除项" maxLength={3000} />{support("scenario")}</label>
          <div className="md:col-span-2" role="group" aria-label="数据模态" {...errorProps("modalities")} tabIndex={-1}><span className="mb-2 block text-sm font-medium">数据模态</span><div className="flex flex-wrap gap-2">{[...new Set([...modalityOptions, ...spec.modalities])].map((item) => <label className="req-modality" key={item}><input type="checkbox" checked={spec.modalities.includes(item)} onChange={(e) => changeSpec("modalities", e.target.checked ? [...spec.modalities, item] : spec.modalities.filter((value) => value !== item))} />{item}</label>)}</div>{support("modalities")}</div>
          <label className="md-field"><span className="md-field-label">需求数量</span><Input aria-label="需求数量" {...errorProps("quantity")} type="number" min={1} value={spec.quantity || ""} onChange={(e) => changeSpec("quantity", Number(e.target.value))} />{support("quantity")}</label><label className="md-field"><span className="md-field-label">计量单位</span><Input aria-label="计量单位" {...errorProps("unit")} value={spec.unit} onChange={(e) => changeSpec("unit", e.target.value)} placeholder="段、小时、条轨迹" maxLength={40} />{support("unit")}</label>
        </fieldset>
        </>}
        <fieldset {...errorProps("checks")} tabIndex={-1} disabled={contractLocked} onChange={() => setTemplateDefaults(false)}><legend className="req-section-label"><span>04</span> 约定验收标准</legend>
          <p className="mb-4 text-sm text-muted-foreground">{platform ? "按用户操作场景写明输入、操作与预期结果。可选添加性能、可用性等量化指标；未添加时按测试报告与验收用例确认。" : "以下阈值为模板示例，请按项目调整。评审通过后锁定，交付时逐项填写实测值和证据。"}</p>
          {support("checks")}
          <div className="space-y-3">{checks.map((check, index) => <div className="req-check-editor" key={check.id}>
            <label className="md-field"><span className="md-field-label">指标 {index + 1}</span><Input aria-label={`指标 ${index + 1}`} {...errorProps(`check-${check.id}-label`)} value={check.label} onChange={(e) => setChecks(checks.map((item) => item.id === check.id ? { ...item, label: e.target.value } : item))} maxLength={160} />{support(`check-${check.id}-label`)}</label>
            <label className="md-field"><span className="md-field-label">条件</span><select className="md-select" value={check.operator} onChange={(e) => setChecks(checks.map((item) => item.id === check.id ? { ...item, operator: e.target.value as AcceptanceCheck["operator"] } : item))}>{Object.entries(operatorLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label className="md-field"><span className="md-field-label">目标值</span><Input aria-label="目标值" {...errorProps(`check-${check.id}-target`)} type="number" step="any" value={Number.isFinite(check.target) ? check.target : ""} onChange={(e) => setChecks(checks.map((item) => item.id === check.id ? { ...item, target: e.target.value === "" ? NaN : Number(e.target.value) } : item))} />{support(`check-${check.id}-target`)}</label>
            <label className="md-field"><span className="md-field-label">单位</span><Input aria-label="单位" {...errorProps(`check-${check.id}-unit`)} value={check.unit} onChange={(e) => setChecks(checks.map((item) => item.id === check.id ? { ...item, unit: e.target.value } : item))} maxLength={40} />{support(`check-${check.id}-unit`)}</label>
            <Button variant="ghost" size="icon" aria-label={`删除指标 ${index + 1}`} onClick={() => setChecks(checks.filter((item) => item.id !== check.id))}><Trash2 /></Button>
          </div>)}</div>
          <Button variant="ghost" className="my-3" disabled={checks.length >= 20} onClick={() => setChecks([...checks, { id: crypto.randomUUID(), label: "", operator: "gte", target: 0, unit: "%" }])}><Plus />添加验收指标</Button>
          {field("acceptance_criteria", "验收方法与补充条件", true, platform ? "例如：管理员选择失败任务并点击重试，生成新的执行记录，保留原失败原因；无权限用户不能操作。" : "抽样方案、固定评测切片、测试方法以及交付清单。评审通过前需确认。")}
        </fieldset>
        <div className="req-form-footer"><p className="mr-auto flex items-center gap-2 text-sm text-muted-foreground"><Database className="size-4" />{requirement ? "保存后可在详情中提交评审" : "草稿仅本人和管理人员可见"}</p><Button data-track-id="requirements.form.save" data-track-label="保存需求草稿或修改" variant="outline" disabled={mutation.isPending} onClick={form.handleSubmit((values, event) => save(values, true, interactionForEvent(event?.nativeEvent)))}><Save />{requirement ? "保存修改" : "保存草稿"}</Button>{!requirement && <Button data-track-id="requirements.form.submit" data-track-label="提交需求评审" type="submit" disabled={mutation.isPending}><Send />{mutation.isPending ? "保存中" : "提交评审"}</Button>}</div>
        </fieldset>
      </form>
    </CardContent>
  </Card>;
}
