import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

/** Material secondary tabs with one associated panel and library-managed keyboard navigation. */
export function MaterialTabs({ tabs, value, onChange, children, label = "内容页签", className = "" }: {
  tabs: readonly { id: string; label: ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return <Tabs.Root value={value} onValueChange={(next) => onChange(String(next))} className={className}>
    <Tabs.List className="md-tabs" aria-label={label}>
      {tabs.map((tab) => <Tabs.Tab key={tab.id} value={tab.id} className="md-tab md-state-layer">{tab.label}</Tabs.Tab>)}
    </Tabs.List>
    <Tabs.Panel value={value} className="md-tab-panel">{children}</Tabs.Panel>
  </Tabs.Root>;
}
