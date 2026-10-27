import { interactionForEvent, type InteractionContext } from "../telemetry";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createFlywheelEvent, dashboardQueryOptions, eventsQueryOptions } from "../api";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

const eventSchema = z.object({
  title: z.string().trim().min(2, "事件名称至少 2 个字符").max(80, "事件名称不能超过 80 个字符"),
  source: z.string().trim().min(2, "数据源至少 2 个字符").max(40, "数据源不能超过 40 个字符"),
  stage: z.enum(["ingest", "label", "train", "evaluate", "ship", "observe"]),
  volume: z.coerce.number().int("数据量必须是整数").min(1, "数据量至少为 1"),
});

type EventFormInput = z.input<typeof eventSchema>;
type EventFormValues = z.output<typeof eventSchema>;

export function EventForm({ csrfToken }: { csrfToken: string }) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const form = useForm<EventFormInput, unknown, EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: { title: "", source: "", stage: "ingest", volume: 1 },
  });
  const mutation = useMutation({
    mutationFn: ({ values, interaction }: { values: EventFormValues; interaction?: InteractionContext }) => createFlywheelEvent(values, csrfToken, interaction),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: eventsQueryOptions.queryKey }),
      ]);
      form.reset();
    },
  });

  const titleError = form.formState.errors.title?.message;
  const sourceError = form.formState.errors.source?.message;
  const volumeError = form.formState.errors.volume?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>录入数据事件</CardTitle>
        <CardDescription>记录数据来源、飞轮阶段与数量，提交后可在事件流水中查看。</CardDescription>
      </CardHeader>
      <CardContent>
        <form aria-busy={mutation.isPending} onSubmit={form.handleSubmit((values, event) => mutation.mutate({ values, interaction: interactionForEvent(event?.nativeEvent) }))}>
          <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_10rem_9rem_auto] xl:items-start">
          <label className="md-field">
            <span id={`${fieldId}-title-label`} className="md-field-label">事件名称</span>
            <Input placeholder="例如：高价值样本入湖" aria-invalid={Boolean(titleError)} aria-labelledby={`${fieldId}-title-label`} aria-describedby={`${fieldId}-title-support`} {...form.register("title")} />
            <span id={`${fieldId}-title-support`} className="md-field-supporting" data-error={Boolean(titleError)}>{titleError ?? "2-80 个字符"}</span>
          </label>
          <label className="md-field">
            <span id={`${fieldId}-source-label`} className="md-field-label">数据源</span>
            <Input placeholder="event-stream" aria-invalid={Boolean(sourceError)} aria-labelledby={`${fieldId}-source-label`} aria-describedby={`${fieldId}-source-support`} {...form.register("source")} />
            <span id={`${fieldId}-source-support`} className="md-field-supporting" data-error={Boolean(sourceError)}>{sourceError ?? "2-40 个字符"}</span>
          </label>
          <label className="md-field">
            <span className="md-field-label">飞轮阶段</span>
            <select className="md-select" aria-label="飞轮阶段" {...form.register("stage")}>
              <option value="ingest">采集</option>
              <option value="label">标注</option>
              <option value="train">训练</option>
              <option value="evaluate">评估</option>
              <option value="ship">发布</option>
              <option value="observe">观测</option>
            </select>
            
            <span className="md-field-supporting" aria-hidden="true" />
          </label>
          <label className="md-field">
            <span id={`${fieldId}-volume-label`} className="md-field-label">数据量</span>
            <Input type="number" min={1} aria-invalid={Boolean(volumeError)} aria-labelledby={`${fieldId}-volume-label`} aria-describedby={`${fieldId}-volume-support`} {...form.register("volume")} />
            <span id={`${fieldId}-volume-support`} className="md-field-supporting" data-error={Boolean(volumeError)}>{volumeError ?? "最少 1 条"}</span>
          </label>
          <Button data-track-id="events.create" data-track-label="录入数据事件" className="mt-4 xl:mt-4" type="submit" disabled={mutation.isPending}>
            <Plus />{mutation.isPending ? "写入中" : "写入事件"}
          </Button>
          </fieldset>
        </form>
        {mutation.isError && <p className="md-body-small mt-3 text-destructive" role="alert">{mutation.error.message}</p>}
        {mutation.isSuccess && <p className="md-body-small mt-3 text-success" role="status">事件已写入并刷新网格。</p>}
      </CardContent>
    </Card>
  );
}
