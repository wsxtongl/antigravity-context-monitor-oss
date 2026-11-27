# Changelog

All notable changes to **Antigravity Context Monitor** will be documented in this file.

## [1.2.0] - 2026-11-27

### Added
- **多时间范围查询**：新增 `今天 / 近 3 天 / 近 7 天 / 近 30 天 / 全部` 快捷切换及自定义起止日期筛选。
- **每日消耗趋势柱状图与明细表**：支持按费用、非缓存 Token、调用次数切换视图，附带分模型统计。
- **一键报表导出**：支持复制 Markdown 统计报表与导出 UTF-8 BOM CSV 文件（Excel 直接打开无乱码）。
- **开源工程化完善**：新增 `scripts/install.{bat,sh}`、`scripts/uninstall.{bat,sh}`、Node 原生自动化测试套件 (`tests/smoke.test.js`)、GitHub Actions CI 及中英双语文档。

## [1.1.0] - 2026-11-27

### Added
- **模型参考费用与缓存节省估算**：内置 Gemini / Claude / GPT 参考单价表，实时展示输入/缓存/输出费用及提示词缓存节省金额。
- **币种切换与自定义单价**：支持 USD / CNY 一键切换、自定义汇率与模型单价，持久化至 `${PLUGIN_DATA}/pricing.json`。
- **自定义刷新频率**：顶栏支持 `10秒 / 30秒 / 60秒 / 关闭` 四档刷新频率。

## [1.0.0] - 2026-11-27

### Added
- 首个 Antigravity MCP App 官方插件版本：支持右侧辅助面板（`aux_pane`）与左侧边栏全屏（`global`）双入口。
- 实时展示当前上下文水位环、缓存命中率、上下文增长曲线（SVG）、模型与工具分布及逐次调用明细。
