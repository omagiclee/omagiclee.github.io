import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { gridTheme, gridLocaleZhCN } from "../../src/components/ui/grid-theme";
import { useState } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Card } from "../../src/components/ui/card";
import { Badge } from "../../src/components/ui/badge";
import { Progress } from "../../src/components/ui/progress";
import { MaterialTabs } from "../../src/components/ui/tabs";
import { ToolbarSelect } from "../../src/components/ui/period-menu";
import "../../src/App.css";

ModuleRegistry.registerModules([AllCommunityModule]);
const buttonVariants = ["default", "elevated", "secondary", "outline", "ghost", "link", "destructive", "destructive-text"] as const;
const fieldStates = ["normal", "error", "disabled", "disabled-error", "readonly", "readonly-error"] as const;
function Fixture() {
  const [tab, setTab] = useState("first");
  const [period, setPeriod] = useState(30);
  return <main className="md-page" style={{ maxWidth: 1000 }}>
    <h1 className="md-page-title">Google Cloud 控制台组件审计</h1>
    <section aria-label="Buttons" style={{ display: "flex", flexWrap: "wrap", gap: 12, paddingBlock: 16 }}>
      {buttonVariants.map(variant => <div key={variant}><Button data-testid={`button-${variant}`} variant={variant}>{variant}</Button><Button data-testid={`button-${variant}-disabled`} variant={variant} disabled>Disabled</Button></div>)}
      <Button data-testid="icon-button" size="icon" variant="ghost" aria-label="图标操作"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18" stroke="currentColor" /></svg></Button>
    </section>
    <section aria-label="Fields" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
      {fieldStates.map(state => <label className="md-field" key={state}><span className="md-field-label">Input {state}</span><Input data-testid={`input-${state}`} defaultValue={state} readOnly={state.startsWith("readonly")} disabled={state.startsWith("disabled")} aria-invalid={state.includes("error") ? true : undefined} placeholder="请输入" /></label>)}
      {fieldStates.map(state => <label className="md-field" key={`textarea-${state}`}><span className="md-field-label">Textarea {state}</span><textarea className="md-textarea" data-testid={`textarea-${state}`} defaultValue={state} readOnly={state.startsWith("readonly")} disabled={state.startsWith("disabled")} aria-invalid={state.includes("error") ? true : undefined} placeholder="请输入" /></label>)}
      {["normal", "error", "disabled", "disabled-error"].map(state => <label className="md-field" key={`select-${state}`}><span className="md-field-label">Select {state}</span><select className="md-select" data-testid={`select-${state}`} disabled={state.startsWith("disabled")} aria-invalid={state.includes("error") ? true : undefined}><option>当前选项</option><option>另一个选项</option></select></label>)}
      <label className="md-field"><span className="md-field-label">Empty field</span><Input data-testid="input-empty" placeholder="请输入" /></label>
      <label className="md-field"><span className="md-field-label">Empty disabled field</span><Input data-testid="input-disabled-empty" disabled placeholder="请输入" /></label>
      <label className="md-field"><span className="md-field-label">Native control</span><select data-testid="select-native"><option>当前选项</option><option>另一个选项</option></select></label>
      <label className="md-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" /></svg><Input aria-label="搜索" /></label>
    </section>
    <section aria-label="Cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, paddingBlock: 16 }}>
      {["surface", "filled", "elevated", "outlined"].map(variant => <Card key={variant} variant={variant as "surface"} data-testid={`card-${variant}`} className="p-4"><h2 className="md-title-medium">{variant}</h2><label className="md-field"><span className="md-field-label">Card field</span><Input defaultValue="Value" /></label></Card>)}
    </section>
    <section aria-label="Status extensions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {["default", "secondary", "outline", "warning", "success", "info", "destructive"].map(variant => <Badge key={variant} variant={variant as "default"}>{variant}</Badge>)}
    </section>
    <section aria-label="Progress" style={{ display: "grid", gap: 16, paddingBlock: 16 }}>
      {[0, 45, 100, null, NaN].map((value, index) => <Progress key={index} data-testid={`progress-${index}`} value={value} aria-label={`进度 ${index}`} />)}
      <Progress data-testid="progress-invalid-range" value={42} min={100} max={0} aria-label="非法范围归一" />
    </section>
    <MaterialTabs value={tab} onChange={setTab} label="审计页签" tabs={[{ id: "first", label: "First" }, { id: "second", label: "Second" }, { id: "third", label: "Third" }]}><p>{tab} panel</p></MaterialTabs>
    <section aria-label="表格" style={{ height: 220, marginBlock: 16 }}><AgGridReact theme={gridTheme} localeText={gridLocaleZhCN} rowData={[{ name: "记录 A" }, { name: "记录 B" }]} columnDefs={[{ field: "name", headerName: "名称", sortable: true, flex: 1 }]} /></section>
    <ToolbarSelect value={period} onChange={setPeriod} label="统计周期" options={[7, 30, 90].map(value => ({ value, label: `最近 ${value} 天` }))} />
    <ToolbarSelect value={period} onChange={setPeriod} label="禁用周期" disabled options={[{ value: period, label: `最近 ${period} 天` }]} />
  </main>;
}
const direction = new URLSearchParams(location.search).get("dir") === "rtl" ? "rtl" : "ltr";
document.documentElement.dir = direction;
createRoot(document.getElementById("root")!).render(<DirectionProvider direction={direction}><Fixture /></DirectionProvider>);
