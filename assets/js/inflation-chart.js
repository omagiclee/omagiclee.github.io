(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const node = (tag, attrs = {}, text) => {
    const element = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function init(figure) {
    if (figure.dataset.chartReady) return;
    const source = figure.querySelector(".inflation-chart__dataset");
    let data;
    try { data = JSON.parse(source.textContent); } catch (_) { return; }
    if (!Array.isArray(data) || data.length < 2 || data.some(d => ![d.year, d.china, d.us].every(Number.isFinite))) return;
    figure.dataset.chartReady = "true";
    const canvas = figure.querySelector(".inflation-chart__canvas");
    const inspection = figure.querySelector(".inflation-chart__inspection");
    const output = figure.querySelector(".inflation-chart__values");
    const previous = figure.querySelector(".inflation-chart__previous");
    const next = figure.querySelector(".inflation-chart__next");
    let selected = data.length - 1;
    let geometry;
    let lastWidth = 0;
    let cursor, chinaHighlight, usHighlight;
    const first = data[0].year, last = data[data.length - 1].year;
    canvas.setAttribute("role", "slider");
    canvas.setAttribute("aria-valuemin", first);
    canvas.setAttribute("aria-valuemax", last);
    canvas.setAttribute("aria-orientation", "horizontal");
    const format = (d, key) => d[`${key}Label`] || `${d[key].toFixed(1)}%`;
    function update(index, announce = true) {
      selected = Math.max(0, Math.min(data.length - 1, index));
      const d = data[selected];
      canvas.setAttribute("aria-valuenow", d.year);
      canvas.setAttribute("aria-valuetext", `${d.year} 年，中国大陆 ${format(d, "china")}，美国 ${format(d, "us")}`);
      if (geometry) {
        const px = geometry.x(d.year);
        cursor.setAttribute("x1", px); cursor.setAttribute("x2", px);
        chinaHighlight.setAttribute("cx", px); chinaHighlight.setAttribute("cy", geometry.y(d.china));
        const usY = geometry.y(d.us);
        usHighlight.setAttribute("d", `M${px},${usY - 5.5}l5.5,5.5l-5.5,5.5l-5.5,-5.5Z`);
      }
      // Pointer browsing is silent to screen readers; keyboard and buttons announce.
      output.setAttribute("aria-live", announce ? "polite" : "off");
      output.replaceChildren();
      const year = document.createElement("strong"); year.textContent = `${d.year} 年`;
      const china = document.createElement("span"); china.className = "inflation-chart__value--china"; china.textContent = `中国大陆 ${format(d, "china")}`;
      const us = document.createElement("span"); us.className = "inflation-chart__value--us"; us.textContent = `美国 ${format(d, "us")}`;
      output.append(year, china, us);
      previous.disabled = selected === 0; next.disabled = selected === data.length - 1;
    }
    function draw() {
      const width = canvas.clientWidth;
      if (width < 1) return;
      lastWidth = width;
      const height = canvas.clientHeight;
      const mobile = width < 480;
      const left = mobile ? 33 : 39, right = mobile ? 15 : 22, top = 30, bottom = 33;
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      const min = Math.min(-2, Math.floor(Math.min(...data.flatMap(d => [d.china, d.us])) / 2) * 2);
      const max = Math.max(10, Math.ceil(Math.max(...data.flatMap(d => [d.china, d.us])) / 2) * 2);
      const x = year => left + (year - first) / (last - first) * plotWidth;
      const y = value => top + (max - value) / (max - min) * plotHeight;
      geometry = { x, y, left, right, top, width, height };
      const svg = node("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": `${figure.id}-svg-title ${figure.id}-svg-desc` });
      svg.append(node("title", { id: `${figure.id}-svg-title` }, figure.querySelector("figcaption strong").textContent));
      svg.append(node("desc", { id: `${figure.id}-svg-desc` }, `${first} 至 ${last} 年年度平均 CPI 同比。蓝色实线圆点为中国大陆，橙色虚线菱形为美国。负值表示物价下降；每年确切数据可用左右方向键查看，或展开原始数据。`));
      for (let tick = min; tick <= max; tick += 2) {
        svg.append(node("line", { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: tick === 0 ? "inflation-chart__zero" : "inflation-chart__grid" }));
        svg.append(node("text", { x: left - 9, y: y(tick) + 4, "text-anchor": "end" }, `${tick}`));
      }
      const tickYears = mobile ? [first, 2005, 2015, last] : [first, 2000, 2005, 2010, 2015, 2020, last];
      [...new Set(tickYears)].filter(year => year >= first && year <= last).forEach(year => {
        svg.append(node("text", { x: x(year), y: height - 9, "text-anchor": year === first ? "start" : year === last ? "end" : "middle" }, `${year}`));
      });
      ["china", "us"].forEach(key => {
        svg.append(node("path", { d: data.map((d, i) => `${i ? "L" : "M"}${x(d.year).toFixed(2)},${y(d[key]).toFixed(2)}`).join(" "), class: `inflation-chart__line inflation-chart__${key}`, ...(key === "us" ? { "stroke-dasharray": "6 4" } : {}) }));
        data.forEach(d => {
          const px = x(d.year), py = y(d[key]);
          if (key === "china") svg.append(node("circle", { cx: px, cy: py, r: mobile ? 2.4 : 2.7, class: "inflation-chart__marker inflation-chart__marker--china" }));
          else svg.append(node("path", { d: `M${px},${py - 3.3}l3.3,3.3l-3.3,3.3l-3.3,-3.3Z`, class: "inflation-chart__marker inflation-chart__marker--us" }));
        });
      });
      function annotate(year, key, align, offset) {
        const d = data.find(row => row.year === year);
        if (!d) return;
        const px = x(year), py = y(d[key]);
        const group = node("g", { class: `inflation-chart__annotation inflation-chart__annotation--${key}` });
        const labelY = Math.max(top - 12, py - offset);
        group.append(node("line", { x1: px, y1: py - 5, x2: px, y2: labelY + 5 }));
        group.append(node("text", { x: px, y: labelY, "text-anchor": align }, `${year} · ${format(d, key)}`));
        svg.append(group);
      }
      annotate(1996, "china", "start", 17);
      if (!mobile) annotate(2008, "china", "middle", 18);
      annotate(2022, "us", "end", 17);
      cursor = node("line", { y1: top, y2: height - bottom, class: "inflation-chart__cursor" });
      chinaHighlight = node("circle", { r: 5, class: "inflation-chart__highlight inflation-chart__china" });
      usHighlight = node("path", { class: "inflation-chart__highlight inflation-chart__us" });
      svg.append(cursor, chinaHighlight, usHighlight);
      const overlay = node("rect", { x: left, y: top - 15, width: plotWidth, height: plotHeight + 25, class: "inflation-chart__overlay" });
      function inspect(event) {
        const bounds = svg.getBoundingClientRect();
        const px = (event.clientX - bounds.left) * width / bounds.width;
        const year = first + (px - left) / plotWidth * (last - first);
        let index = 0;
        data.forEach((d, i) => { if (Math.abs(d.year - year) < Math.abs(data[index].year - year)) index = i; });
        if (index !== selected) update(index, false);
      }
      overlay.addEventListener("pointermove", inspect);
      overlay.addEventListener("pointerdown", inspect);
      svg.append(overlay);
      canvas.replaceChildren(svg);
      inspection.hidden = false;
      update(selected, false);
    }
    canvas.addEventListener("keydown", event => {
      const directions = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: data.length - 1 };
      if (Object.hasOwn(directions, event.key)) { event.preventDefault(); update(directions[event.key], false); }
    });
    previous.addEventListener("click", () => update(selected - 1));
    next.addEventListener("click", () => update(selected + 1));
    draw();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
      if (Math.abs(canvas.clientWidth - lastWidth) > .5) draw();
    }).observe(canvas);
    else window.addEventListener("resize", draw, { passive: true });
  }
  const initialize = () => document.querySelectorAll(".inflation-chart").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
