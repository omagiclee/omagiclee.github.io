import { themeQuartz, type LocaleText } from "ag-grid-community";

export const gridLocaleZhCN: LocaleText = {
  pageSizeSelectorLabel: "每页条数：", page: "第", of: "/", to: "–", more: "更多", pageLastRowUnknown: "未知", number: "页码",
  firstPage: "首页", previousPage: "上一页", nextPage: "下一页", lastPage: "末页", noRowsToShow: "没有符合条件的记录", loadingOoo: "正在加载…",
  filterOoo: "筛选…", searchOoo: "搜索…", equals: "等于", notEqual: "不等于", blank: "为空", notBlank: "不为空",
  contains: "包含", notContains: "不包含", startsWith: "开头是", endsWith: "结尾是", lessThan: "小于", greaterThan: "大于", lessThanOrEqual: "小于或等于", greaterThanOrEqual: "大于或等于", inRange: "范围内", andCondition: "并且", orCondition: "或者",
  applyFilter: "应用", resetFilter: "重置", clearFilter: "清除", cancelFilter: "取消", selectAll: "全选", selectAllSearchResults: "选择全部搜索结果", blanks: "空白",
  sortAscending: "升序", sortDescending: "降序", sortUnSort: "取消排序", pinColumn: "固定列", pinLeft: "固定到左侧", pinRight: "固定到右侧", noPin: "取消固定", autosizeThiscolumn: "调整此列宽度", autosizeAllColumns: "调整所有列宽度", resetColumns: "重置列",
  ariaColumn: "列", ariaRow: "行", ariaSearch: "搜索", ariaPageSizeSelectorLabel: "每页条数", ariaFilterColumn: "按列筛选", ariaRowSelect: "按空格选择行", ariaRowDeselect: "按空格取消选择行",
  ariaToggleVisibility: "按空格切换可见性", ariaSortableColumn: "按 Enter 排序", ariaFilterInput: "筛选输入", ariaLabelColumnMenu: "列菜单", ariaLabelCellEditor: "单元格编辑器",
};

export const gridTheme = themeQuartz.withParams({
  accentColor: "var(--md-sys-color-primary)",
  backgroundColor: "var(--md-sys-color-surface-container-lowest)",
  borderColor: "var(--md-sys-color-outline-variant)",
  borderRadius: 8,
  foregroundColor: "var(--md-sys-color-on-surface)",
  headerBackgroundColor: "var(--md-sys-color-surface-container-low)",
  headerFontSize: 12,
  headerFontWeight: 500,
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  oddRowBackgroundColor: "var(--md-sys-color-surface-container-lowest)",
  rowBorder: { color: "var(--md-sys-color-outline-variant)" },
  spacing: 8,
  rowHeight: 48,
  headerHeight: 48,
  wrapperBorder: false,
});
