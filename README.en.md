# Antigravity Context Monitor

[中文](README.md) | English

An official **MCP App plugin** for **Google Antigravity 2.0** that lets you monitor context window usage, prompt cache hit rates, multi-day token trends, and estimated API costs directly inside Antigravity—**100% read-only, zero `app.asar` modification, and zero external network calls**.

---

## Key Features

* **Zero Modification & Local-Only**: Built on Antigravity's official Plugin and MCP App specification (`ui://` isolated iframe + JSON-RPC over `postMessage`). Never touches `app.asar`, injects processes, or opens network ports.
* **Zero Token Overhead**: All dashboard refreshes call app-only local tools (`visibility: ["app"]`) that read local `transcript.jsonl` files directly without invoking any LLM.
* **Native Side Pane & Full-Page Views**:
  * **Side Pane (`aux_pane`)**: Click `+` in the conversation side pane -> `上下文监控` for a compact live view alongside chat.
  * **Sidebar Full-Page (`global`)**: Open from the left sidebar for multi-conversation overview, trend charts, and step-by-step ledgers.
  * Automatically adapts to Antigravity light/dark theme variables.
* **Fine-Grained Usage Trends & Date Range Analytics**:
  * Query **Today / Last 3 Days / Last 7 Days / Last 30 Days / All Time** or a **custom date range**;
  * Hourly breakdown (`00:00` to current hour) for single-day views with **Hourly / Daily** toggle for short ranges and responsive non-overlapping axis labels in narrow side panes;
  * Segmented **`Tokens | Requests | Cost`** switcher with stacked total tokens (`Input + Cache + Output`) and instant hover tooltips.
* **Built for Long Conversations**:
  * Clean crosshair-driven context growth chart with **`Last 30 | Last 100 | All`** step windows and collapsible side-pane mode;
  * Paginated step-by-step ledger (`10 / 20 / 50 / All` per page).
* **Estimated API Cost**:
  * Built-in reference pricing for Gemini 4, Gemini 3.8/3.1, Claude, and GPT-4o;
  * Shows estimated cost breakdown (`Input / Cache / Output`);
  * Toggle `$ USD` / `¥ CNY` and customize per-model rates & FX rate (persisted in `${PLUGIN_DATA}/pricing.json`).
* **Configurable Polling & Export**: Switch auto-refresh between `10s / 30s / 60s / Off`, copy Markdown summary reports, or export Excel-compatible UTF-8 CSV files.

---

## Installation (No Restart Required)

> **Prerequisite**: [Node.js](https://nodejs.org/) 18.18+. Prebuilt zero-dependency bundles are included in `dist/`, so no `npm install` is required for end users.

### Option 1: Direct `git clone` (Recommended)

**macOS / Linux:**
```bash
git clone https://github.com/wsxtongl/antigravity-context-monitor-oss.git ~/.gemini/config/plugins/context-monitor
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/wsxtongl/antigravity-context-monitor-oss.git "$env:USERPROFILE\.gemini\config\plugins\context-monitor"
```

### Option 2: Installer Scripts

1. Download and extract the repository archive.
2. Run the script for your OS:
   * **Windows**: Double-click `scripts/install.bat`
   * **macOS / Linux**: `bash scripts/install.sh`

### Uninstall

Disable or uninstall from Antigravity **Customizations**, or run `scripts/uninstall.bat` / `bash scripts/uninstall.sh`.

---

## Development & Testing

```bash
npm install
npm run build          # Bundle dist/app.html & dist/server.cjs with syntax/size gates
npm test               # Run manifest, CSP/syntax, mock transcript, and MCP stdio tests
npm run install:local  # Build and copy runtime assets to ~/.gemini/config/plugins/context-monitor
```

## License

[MIT](LICENSE)
