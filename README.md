# Antigravity Context Monitor（上下文与 Token 监控插件）

中文 | [English](README.en.md)

一款专为 **Google Antigravity 2.0** 打造的 **官方 MCP App 插件**——纯本地只读、**零改动客户端本体（不碰 `app.asar`）**、**零外部网络请求**，直接在 Antigravity 右侧辅助栏或左侧边栏全屏实时查看上下文窗口水位、缓存命中率、多日消耗趋势与模型参考费用。

---

## 核心特性

* **零侵入 · 安全合规**：完全基于 Antigravity 官方插件与 MCP App 协议运行，不修改客户端任何文件、不注入进程、不监听外部端口、不发起任何网络请求。
* **0 模型调用开销**：面板刷新与数据查询均通过 App 专属本地工具（`visibility: ["app"]`）直接读取本地官方日志 `transcript.jsonl`，不经过大模型，不额外消耗任何 Token。
* **双原生入口 & 主题同步**：
  * **右侧辅助面板（`aux_pane`）**：点击对话右侧 `+` -> `上下文监控`，窄栏自适应，边聊边看实时水位。
  * **左侧边栏全屏（`global`）**：点击左侧栏 `上下文监控`，双栏总览全部会话、图表与明细。
  * 自动跟随 Antigravity 浅色 / 深色主题，无需手动切换。
* **多维度时间范围查询**：支持 **今天 / 近 3 天 / 近 7 天 / 近 30 天 / 全部** 以及 **自定义起止日期**，配套每日消耗柱状图（可切按费用 / 非缓存 Token / 调用次数）、分模型费用分布与每日明细表。
* **模型参考费用 & 缓存节省估算**：
  * 内置 Gemini 4 / Gemini 3.8 / Gemini 3.1 / Claude / GPT 等主流 API 参考单价；
  * 实时计算提示词缓存帮你节省的金额；
  * 支持 `$ USD` / `¥ CNY` 币种切换与自定义单价/汇率（持久化保存于 `${PLUGIN_DATA}/pricing.json`）。
* **灵活刷新 & 报表导出**：顶栏支持 `10秒 / 30秒 / 60秒 / 关闭` 刷新频率切换；支持一键 **复制 Markdown 报表** 和 **导出 Excel 兼容 CSV**。

---

## 快速安装（无需重启 Antigravity）

> **前置要求**：本机已安装 [Node.js](https://nodejs.org/) 18.18+（仓库已内置预构建的 `dist/` 产物，普通用户无需执行 `npm install`）。

### 方式一：一条命令克隆即安装（推荐，支持 `git pull` 更新）

**macOS / Linux：**
```bash
git clone https://github.com/wsxtongl/antigravity-context-monitor-oss.git ~/.gemini/config/plugins/context-monitor
```

**Windows (PowerShell)：**
```powershell
git clone https://github.com/wsxtongl/antigravity-context-monitor-oss.git "$env:USERPROFILE\.gemini\config\plugins\context-monitor"
```

### 方式二：下载 Release / ZIP 一键脚本安装

1. 下载并解压本仓库压缩包；
2. 运行对应系统的一键安装脚本：
   * **Windows**：双击运行 `scripts/install.bat`
   * **macOS / Linux**：终端执行 `bash scripts/install.sh`

### 方式三：团队项目内共享

将本仓库核心目录（`plugin.json`、`mcp_config.json`、`assets/`、`dist/`）放入团队仓库的 `.agents/plugins/context-monitor/` 目录并提交，团队成员打开该工作区即可自动加载。

### 卸载方式

* 在 Antigravity 左侧 **自定义（Customizations）** 中停用或卸载，或直接运行 `scripts/uninstall.bat`（Windows）/ `bash scripts/uninstall.sh`（macOS / Linux）。

---

## 指标计算说明

| 指标 | 计算方式 | 说明 |
| :--- | :--- | :--- |
| **当前上下文** | `input_tokens + cache_read_tokens` | 最新一次模型调用时，模型实际看到的上下文窗口长度 |
| **缓存命中率** | `cache_read_tokens / (input_tokens + cache_read_tokens)` | 越高代表复用缓存越多、延迟更低且按 API 计费越省钱 |
| **参考费用** | `(新增输入×输入价 + 缓存读取×缓存价 + 输出×输出价) / 10⁶` | 仅按公开 API 标价折算，供成本感知参考，不代表订阅实际账单 |
| **缓存约省** | `cache_read_tokens × (输入价 - 缓存价) / 10⁶` | 若未命中缓存需按全额输入计费的差额 |
| **压缩/回落标记** | 单步上下文骤降超过 30% 且降幅 > 10K | 用于在曲线图上提示可能发生了 `/compact` 或上下文压缩 |

---

## 隐私与安全声明

* **数据源**：仅以只读方式读取 `~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`（可通过环境变量 `ANTIGRAVITY_BRAIN_DIR` 自定义）。
* **网络行为**：零外网请求，零遥测上报，零第三方 CDN（所有脚本与样式均打包为单文件本地资源，遵循默认 `default-src 'none'` CSP）。
* **本地写入**：仅在你点击「保存配置」修改单价/币种时，向插件专属数据目录写入 `pricing.json`。

---

## 本地开发与构建

```bash
# 安装构建依赖（esbuild 与 MCP SDK）
npm install

# 构建 dist/app.html 与 dist/server.cjs（含内联 JS 语法门禁与体积校验）
npm run build

# 运行自动化测试（Manifest 校验、CSP/语法校验、多日模拟日志与 MCP stdio 集成测试）
npm test

# 构建并同步安装到本机 ~/.gemini/config/plugins/context-monitor
npm run install:local
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CHANGELOG.md](CHANGELOG.md)。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
