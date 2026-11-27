'use strict';

const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { scanAllConversations, getConversationDetail } = require('./transcript');
const { loadPricingConfig, savePricingConfig } = require('./pricing');

const APP_URI = 'ui://context-monitor/app.html';
const APP_MIME = 'text/html;profile=mcp-app';

function loadAppHtml() {
  const htmlPath = process.env.CONTEXT_MONITOR_APP_HTML
    || path.join(__dirname, 'app.html');
  return fs.readFileSync(htmlPath, 'utf8');
}

function fmtCompact(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtMoney(usd, cfg) {
  const isCny = cfg && cfg.currency === 'CNY';
  const val = isCny ? Number(usd || 0) * (cfg.cnyRate || 7.25) : Number(usd || 0);
  const sym = isCny ? '¥' : '$';
  if (val > 0 && val < 0.01) return `${sym}${val.toFixed(4)}`;
  return `${sym}${val.toFixed(2)}`;
}

const server = new Server(
  {
    name: 'context-monitor',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: APP_URI,
      name: '上下文与 Token 监控面板',
      description: 'Antigravity 本地只读上下文水位、Token 消耗与参考费用可视化界面',
      mimeType: APP_MIME,
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== APP_URI) {
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }
  const text = loadAppHtml();
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: APP_MIME,
        text,
        _meta: {
          ui: {
            prefersBorder: false,
          },
        },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'open_context_monitor',
      title: '上下文监控',
      description:
        '打开 Antigravity 上下文与 Token 监控面板，查看各会话当前上下文占用、缓存命中率、参考费用估算、增长曲线与逐轮工具调用明细（纯本地只读，不修改 Antigravity）。',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: {
            type: 'string',
            description: '可选：指定要聚焦查看的会话 ID，省略时默认打开最近活跃的会话。',
          },
        },
      },
      _meta: {
        ui: {
          resourceUri: APP_URI,
        },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: '上下文监控' },
            { type: 'global', title: '上下文监控' },
          ],
        },
      },
    },
    {
      name: 'get_monitor_overview',
      title: '读取监控总览',
      description: '仅供监控面板 UI 内部调用：读取所有本地会话的上下文、Token 与费用汇总信息。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    {
      name: 'get_conversation_detail',
      title: '读取会话明细',
      description: '仅供监控面板 UI 内部调用：读取指定会话的逐次模型调用 Token、费用与上下文曲线。',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: {
            type: 'string',
            description: '会话 ID',
          },
        },
        required: ['conversationId'],
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
    {
      name: 'save_pricing_config',
      title: '保存模型单价配置',
      description: '仅供监控面板 UI 内部调用：保存币种、汇率与自定义模型单价并返回最新估算结果。',
      inputSchema: {
        type: 'object',
        properties: {
          currency: { type: 'string', enum: ['USD', 'CNY'] },
          cnyRate: { type: 'number' },
          overrides: { type: 'object' },
          conversationId: { type: 'string' },
        },
      },
      _meta: {
        ui: {
          visibility: ['app'],
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === 'open_context_monitor') {
    const pricingConfig = loadPricingConfig();
    const overview = scanAllConversations();
    const requestedId = typeof args.conversationId === 'string' && args.conversationId.trim()
      ? args.conversationId.trim()
      : null;
    const targetId = requestedId
      || (overview.conversations[0] ? overview.conversations[0].id : null);
    const detail = targetId ? getConversationDetail(targetId, 120) : null;

    const lines = [
      `已加载本地 Antigravity 上下文监控（共 ${overview.summary.conversationCount} 个会话，今日调用 ${overview.summary.todayCalls} 次，今日参考费用 ${fmtMoney(overview.summary.todayCostUsd, pricingConfig)}）。`,
    ];
    if (detail) {
      const pct = ((detail.currentContext / detail.defaultContextLimit) * 100).toFixed(1);
      lines.push(
        `当前聚焦会话「${detail.title}」(${detail.id.slice(0, 8)}): ` +
        `上下文 ${detail.currentContext.toLocaleString('en-US')} tokens (${pct}% / ${fmtCompact(detail.defaultContextLimit)})，` +
        `缓存命中率 ${(detail.currentCacheHitRate * 100).toFixed(1)}%，` +
        `本会话参考费用 ${fmtMoney(detail.cost.totalUsd, pricingConfig)}（缓存约省 ${fmtMoney(detail.cost.cacheSavedUsd, pricingConfig)}）。`
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        pricingConfig,
        overview,
        selectedId: targetId,
        detail,
      },
    };
  }

  if (name === 'get_monitor_overview') {
    const pricingConfig = loadPricingConfig();
    const overview = scanAllConversations();
    return {
      content: [{ type: 'text', text: `conversations=${overview.conversations.length}` }],
      structuredContent: {
        ...overview,
        pricingConfig,
      },
    };
  }

  if (name === 'get_conversation_detail') {
    const convId = typeof args.conversationId === 'string' ? args.conversationId.trim() : '';
    const detail = getConversationDetail(convId, 300);
    if (!detail) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Conversation not found: ${convId}` }],
      };
    }
    return {
      content: [{ type: 'text', text: `steps=${detail.steps.length}` }],
      structuredContent: detail,
    };
  }

  if (name === 'save_pricing_config') {
    const saved = savePricingConfig({
      currency: args.currency,
      cnyRate: args.cnyRate,
      overrides: args.overrides,
    });
    const overview = scanAllConversations();
    const convId = typeof args.conversationId === 'string' && args.conversationId.trim()
      ? args.conversationId.trim()
      : (overview.conversations[0]?.id || null);
    const detail = convId ? getConversationDetail(convId, 300) : null;
    return {
      content: [{ type: 'text', text: `saved currency=${saved.currency}` }],
      structuredContent: {
        pricingConfig: saved,
        overview,
        selectedId: convId,
        detail,
      },
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[context-monitor] fatal:', err);
  process.exit(1);
});
