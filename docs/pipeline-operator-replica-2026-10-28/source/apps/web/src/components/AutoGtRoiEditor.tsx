import { useRef } from "react";
import { autoGtImageUrl } from "../auto-gt-api";
import { Button } from "./ui/button";
export type NormalizedRect = [number, number, number, number];
export function validRect(rect: NormalizedRect | null): rect is NormalizedRect { return Boolean(rect && rect.every(Number.isFinite) && rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 && rect[0] + rect[2] <= 1 && rect[1] + rect[3] <= 1); }
export function AutoGtRoiEditor({ imagePath, value, onChange, disabled, label = "ROI" }: { imagePath: string; value: NormalizedRect | null; onChange: (rect: NormalizedRect | null) => void; disabled?: boolean; label?: string }) {
  const start = useRef<[number, number] | null>(null);
  const point = (event: React.PointerEvent<HTMLDivElement>): [number, number] => { const bounds = event.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))]; };
  const draw = (end: [number, number]) => { if (!start.current) return; const [x, y] = start.current; onChange([Math.min(x, end[0]), Math.min(y, end[1]), Math.abs(end[0] - x), Math.abs(end[1] - y)]); };
  return <div className="autogt-roi-editor"><p className="autogt-help">在图像上拖出矩形，或用下方归一化坐标编辑。坐标依据实际图像范围，不包含留白；未画框表示整张配对的问题。</p>
    <div className="autogt-roi-image" aria-label={`${label} 画框图像`} onPointerDown={(event) => { if (disabled || event.button > 0) return; start.current = point(event); event.currentTarget.setPointerCapture?.(event.pointerId); draw(start.current); }} onPointerMove={(event) => { if (!disabled && start.current) draw(point(event)); }} onPointerUp={(event) => { if (start.current) draw(point(event)); start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      <img src={autoGtImageUrl(imagePath)} alt={`${label} 区域依据`} draggable={false} />{value && <span className="autogt-roi-box" style={{ left: `${value[0] * 100}%`, top: `${value[1] * 100}%`, width: `${value[2] * 100}%`, height: `${value[3] * 100}%` }} />}
    </div><div className="autogt-fields">{["X", "Y", "宽", "高"].map((name, index) => <label className="autogt-field" key={name}><span>{label} {name}（0–1）</span><input aria-label={`${label} ${name}（0–1）`} type="number" min={0} max={1} step="any" disabled={disabled} value={value?.[index] ?? ""} onChange={(event) => { const next = [...(value ?? [0, 0, .1, .1])] as NormalizedRect; next[index] = Number(event.target.value); onChange(next); }} /></label>)}</div><Button type="button" variant="ghost" size="sm" disabled={disabled || !value} onClick={() => onChange(null)}>清除当前区域</Button>{value && !validRect(value) && <p role="alert">区域必须有正面积，并完全位于图像内。</p>}
  </div>;
}
