(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const node = (tag, attrs = {}, text) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function init(figure) {
    if (figure.dataset.chartReady) return;
    let data;
    try { data = JSON.parse(figure.querySelector(".gold-price-chart__dataset").textContent); } catch (_) { return; }
    const serial = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
    if (!Array.isArray(data) || data.length < 2 || data.some((d, i) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month) || !Number.isFinite(d.price) || d.price <= 0 || (i && serial(d.month) !== serial(data[i - 1].month) + 1) || (d.change != null && !Number.isFinite(d.change)) || (i && d.change == null))) return;
    figure.dataset.chartReady = "true";
    const canvas = figure.querySelector(".gold-price-chart__canvas");
    const output = figure.querySelector(".gold-price-chart__values");
    const previous = figure.querySelector(".gold-price-chart__previous");
    const next = figure.querySelector(".gold-price-chart__next");
    const buttons = figure.querySelectorAll("[data-mode]");
    const first = data[0].month, last = data.at(-1).month;
    const period = d => `${d.month.slice(0, 4)} 年 ${Number(d.month.slice(5))} 月`;
    let selected = data.length - 1, mode = "price", geometry, cursor, highlight, lastWidth = 0;
    const price = d => d.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const change = d => d.change == null ? "—" : `${d.change > 0 ? "+" : ""}${d.change.toFixed(2)}%`;
    canvas.setAttribute("role", "slider");
    canvas.setAttribute("aria-valuemin", "0"); canvas.setAttribute("aria-valuemax", data.length - 1);
    canvas.setAttribute("aria-orientation", "horizontal");
    function update(index, announce = true) {
      selected = Math.max(0, Math.min(data.length - 1, index));
      const d = data[selected];
      canvas.setAttribute("aria-valuenow", selected);
      canvas.setAttribute("aria-valuetext", `${period(d)}，月均金价 ${price(d)} 美元每金衡盎司，月均价环比 ${change(d)}`);
      if (geometry) {
        const px = geometry.x(selected), value = mode === "price" ? d.price : d.change;
        cursor.setAttribute("x1", px); cursor.setAttribute("x2", px);
        highlight.setAttribute("visibility", value == null ? "hidden" : "visible");
        if (value != null) { highlight.setAttribute("cx", px); highlight.setAttribute("cy", geometry.y(value)); }
      }
      output.setAttribute("aria-live", announce ? "polite" : "off");
      const year = document.createElement("strong"); year.textContent = period(d);
      const p = document.createElement("span"); p.className = "gold-price-chart__value--price"; p.textContent = `$${price(d)} / 金衡盎司`;
      const c = document.createElement("span"); c.className = "gold-price-chart__value--change"; c.textContent = `月均价环比 ${change(d)}`;
      output.replaceChildren(year, p, c);
      previous.disabled = selected === 0; next.disabled = selected === data.length - 1;
    }
    function draw() {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (width < 1) return;
      lastWidth = width;
      const mobile = width < 480, left = mode === "price" ? 48 : 37, right = mobile ? 14 : 23, top = 29, bottom = 34;
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      const values = data.map(d => d[mode]).filter(Number.isFinite);
      const rawMax = Math.max(...values), rawMin = Math.min(0, ...values);
      const range = rawMax - rawMin || 1;
      const roughStep = range / 5, magnitude = 10 ** Math.floor(Math.log10(roughStep));
      const step = [1, 2, 2.5, 5, 10].find(v => v * magnitude >= roughStep) * magnitude;
      const min = mode === "price" ? 0 : Math.floor(rawMin / step) * step;
      const max = Math.ceil(rawMax / step) * step || step;
      const x = index => left + index / (data.length - 1) * plotWidth;
      const y = value => top + (max - value) / (max - min) * plotHeight;
      geometry = { x, y };
      const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": `${figure.id}-svg-title ${figure.id}-svg-desc` });
      svg.append(node("title", { id: `${figure.id}-svg-title` }, `${figure.querySelector("figcaption strong").textContent}：${mode === "price" ? "金价走势" : "月均价变化"}`));
      svg.append(node("desc", { id: `${figure.id}-svg-desc` }, `${first} 至 ${last}。${mode === "price" ? "金色曲线表示美元计价的月度平均金价，单位为美元每金衡盎司。" : "金色柱表示月度平均金价上升，灰色柱表示下降，单位为百分比；不是投资持有期收益。"}逐月数据可通过方向键、前后按钮或原始数据查看。`));
      for (let tick = min; tick <= max + step / 100; tick += step) {
        svg.append(node("line", { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: tick === 0 ? "gold-price-chart__zero" : "gold-price-chart__grid" }));
        svg.append(node("text", { x: left - 9, y: y(tick) + 4, "text-anchor": "end" }, mode === "price" ? tick.toLocaleString("en-US") : `${+tick.toFixed(2)}%`));
      }
      const tickIndexes = [0];
      const firstYear = Number(first.slice(0, 4)), lastYear = Number(last.slice(0, 4));
      const yearStep = 5;
      const minimumTickGap = mobile ? 65 : 58;
      for (let year = Math.ceil(firstYear / yearStep) * yearStep; year <= lastYear; year += yearStep) {
        const index = data.findIndex(d => d.month === `${year}-01`);
        if (index > 0 && x(index) - x(tickIndexes.at(-1)) >= minimumTickGap && x(data.length - 1) - x(index) >= minimumTickGap) tickIndexes.push(index);
      }
      tickIndexes.push(data.length - 1);
      [...new Set(tickIndexes)].forEach(index => svg.append(node("text", { x: x(index), y: height - 9, "text-anchor": index === 0 ? "start" : index === data.length - 1 ? "end" : "middle" }, index === 0 || index === data.length - 1 ? data[index].month : data[index].month.slice(0, 4))));
      if (mode === "price") {
        const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(d.price).toFixed(2)}`).join(" ");
        svg.append(node("path", { d: `${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: "gold-price-chart__area" }));
        svg.append(node("path", { d: path, class: "gold-price-chart__line" }));
        const end = data.at(-1);
        svg.append(node("text", { x: x(data.length - 1), y: Math.max(top - 10, y(end.price) - 13), "text-anchor": "end", class: "gold-price-chart__annotation" }, `${last} · $${price(end)}`));
      } else {
        const barWidth = Math.max(.7, Math.min(16, plotWidth / data.length * .72));
        data.forEach((d, i) => { if (d.change != null) svg.append(node("rect", { x: x(i) - barWidth / 2, y: Math.min(y(d.change), y(0)), width: barWidth, height: Math.max(.8, Math.abs(y(d.change) - y(0))), rx: 1.2, class: `gold-price-chart__bar${d.change < 0 ? " gold-price-chart__bar--negative" : ""}` })); });
      }
      cursor = node("line", { y1: top, y2: height - bottom, class: "gold-price-chart__cursor" });
      highlight = node("circle", { r: 5, class: "gold-price-chart__highlight" });
      svg.append(cursor, highlight);
      const overlay = node("rect", { x: left, y: top - 15, width: plotWidth, height: plotHeight + 25, class: "gold-price-chart__overlay" });
      function inspect(event) {
        const bounds = svg.getBoundingClientRect();
        const px = (event.clientX - bounds.left) * width / bounds.width;
        const index = Math.round((px - left) / plotWidth * (data.length - 1));
        if (Math.max(0, Math.min(data.length - 1, index)) !== selected) update(index, false);
      }
      overlay.addEventListener("pointermove", inspect); overlay.addEventListener("pointerdown", inspect);
      svg.append(overlay); canvas.replaceChildren(svg);
      figure.querySelector(".gold-price-chart__inspection").hidden = false;
      figure.querySelector(".gold-price-chart__toolbar").hidden = false;
      figure.querySelector(".gold-price-chart__unit").textContent = mode === "price" ? "美元 / 金衡盎司" : "月均价环比 · %";
      update(selected, false);
    }
    canvas.addEventListener("keydown", event => {
      const directions = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: data.length - 1 };
      if (Object.hasOwn(directions, event.key)) { event.preventDefault(); update(directions[event.key]); }
    });
    previous.addEventListener("click", () => update(selected - 1)); next.addEventListener("click", () => update(selected + 1));
    buttons.forEach(button => button.addEventListener("click", () => {
      if (button.dataset.mode === mode) return;
      mode = button.dataset.mode;
      buttons.forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false"));
      draw(); update(selected);
    }));
    draw();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (Math.abs(canvas.clientWidth - lastWidth) > .5) draw(); }).observe(canvas);
    else window.addEventListener("resize", draw, { passive: true });
  }
  const initialize = () => document.querySelectorAll(".gold-price-chart").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
