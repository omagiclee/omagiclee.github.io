(() => {
  "use strict";
  function init(root) {
    if (root.dataset.ready) return;
    const tabs = [...root.querySelectorAll("[data-tab]")];
    const panels = [...root.querySelectorAll("[data-panel]")];
    const tablist = root.querySelector(".dlw__tabs");
    const filters = [...root.querySelectorAll("[data-filter]")];
    const samples = [...root.querySelectorAll("[data-sample]")];
    const picks = [...root.querySelectorAll("[data-pick]")];
    const queue = root.querySelector("[data-queue]");
    const roundSelect = root.querySelector("[data-round-select]");
    const selected = new Set();
    function switchTab(tab, focus = false) {
      tabs.forEach(button => {
        const active = button === tab;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      panels.forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
      if (focus) tab.focus();
    }
    tablist.setAttribute("role", "tablist");
    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      const panel = panels.find(p => p.dataset.panel === tab.dataset.tab);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;
      tab.addEventListener("click", () => switchTab(tab));
      tab.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); switchTab(tabs[next], true); }
      });
    });
    const filterStatus = document.createElement("p");
    filterStatus.className = "dlw__filter-status";
    filterStatus.setAttribute("role", "status");
    root.querySelector(".dlw__filters").after(filterStatus);
    function filter(kind) {
      filters.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.filter === kind)));
      let visible = 0;
      samples.forEach(sample => {
        sample.hidden = kind !== "all" && sample.dataset.kind !== kind;
        if (!sample.hidden) visible++;
      });
      filterStatus.textContent = `显示 ${visible} 个演示样本；筛选不清除已选样本。`;
    }
    filters.forEach(button => button.addEventListener("click", () => filter(button.dataset.filter)));
    picks.forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.pick;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      button.setAttribute("aria-pressed", String(selected.has(id)));
      button.textContent = selected.has(id) ? "移出演示选样" : "加入演示选样";
      button.closest("[data-sample]").classList.toggle("is-selected", selected.has(id));
      queue.textContent = selected.size ? `已选择 ${selected.size} 个演示样本：${[...selected].join("、")}。下一步：核验来源与划分，再送 GT 审阅。` : "尚未选择样本。";
    }));
    function switchRound() {
      root.querySelectorAll("[data-round]").forEach(round => { round.hidden = round.dataset.round !== roundSelect.value; });
    }
    roundSelect.addEventListener("change", switchRound);
    switchTab(tabs[0]);
    filter("all");
    switchRound();
    root.querySelectorAll(".dlw__tabs, .dlw__filters, .dlw__pick, .dlw__queue, .dlw__round-picker").forEach(el => { el.hidden = false; });
    root.dataset.ready = "true";
  }
  const boot = () => document.querySelectorAll(".dlw").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
