# 贡献指南 (Contributing)

欢迎提交 Issue 和 Pull Request！无论是补充新模型的默认参考单价、优化 UI 交互还是修复边界问题，都非常欢迎。

## 目录说明

- `src/pricing.js`：内置模型参考单价表（`PRESET_RATES`）与 `${PLUGIN_DATA}/pricing.json` 读写逻辑。
- `src/transcript.js`：只读解析 `transcript.jsonl`，聚合单会话与按日统计数据。
- `src/server.js`：MCP Stdio Server，注册 `open_context_monitor` 与 App 专属工具。
- `src/template.html` & `src/app.js`：单文件 MCP App 前端界面（基于 `@modelcontextprotocol/ext-apps`）。
- `scripts/build.js`：使用 `esbuild` 打包 `dist/app.html` 和 `dist/server.cjs`，并执行语法与体积门禁检查。
- `tests/smoke.test.js`：基于 Node.js 内置 `node:test` 的端到端测试套件。

## 新增或更新模型默认单价

1. 编辑 `src/pricing.js` 中的 `PRESET_RATES`（按美元 / 1M tokens 填写 `input`、`cacheRead`、`output`）。
2. 在 `tests/smoke.test.js` 中补充或校验对应的费用断言。
3. 运行 `npm run check` 确保构建和测试全部通过。

## 提交 PR 前检查

```bash
npm run check
```

请确保：
- 不要在 `src/template.html` 中引入任何外部 CDN 资源（默认 CSP 会拦截）；
- 不要在 `plugin.json` 中添加 Antigravity 规范之外的未知顶层字段；
- `npm run build` 和 `npm test` 在本地 100% 通过。
