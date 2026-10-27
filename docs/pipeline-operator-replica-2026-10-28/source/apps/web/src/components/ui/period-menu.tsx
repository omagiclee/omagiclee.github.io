import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "./button";
import "./period-menu.css";

/** A toolbar choice, distinct from a form text field. */
export function ToolbarSelect<T extends string | number>({ value, onChange, options, label, prefix, disabled = false }: {
  value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; label: string; prefix?: string; disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedDescription = useId();
  const selected = options.find((option) => option.value === value);
  return <Menu.Root>
    <Menu.Trigger ref={trigger} render={<Button variant="outline" size="sm" className="toolbar-select-trigger" />} disabled={disabled} aria-label={label} aria-describedby={selectedDescription}>
      <span id={selectedDescription} className="toolbar-select-label">{prefix && `${prefix}：`}{selected?.label ?? value}</span><ChevronDown aria-hidden="true" />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className="period-menu-positioner" sideOffset={4} align="end">
        <Menu.Popup className="period-menu-popup" finalFocus={trigger} aria-label={label}>
          <Menu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => <Menu.RadioItem key={option.value} value={option.value} className="period-menu-item" closeOnClick>
              <span className="period-menu-check"><Menu.RadioItemIndicator><Check aria-hidden="true" /></Menu.RadioItemIndicator></span>
              {option.label}
            </Menu.RadioItem>)}
          </Menu.RadioGroup>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}

export function PeriodMenu({ value, onChange, disabled }: {
  value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <ToolbarSelect value={value} onChange={onChange} disabled={disabled} label="统计周期" options={[7, 30, 90].map((days) => ({ value: days, label: `最近 ${days} 天` }))} />;
}
