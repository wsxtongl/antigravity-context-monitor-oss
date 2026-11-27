'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_HTML = path.join(REPO_ROOT, 'dist', 'app.html');
const DIST_SERVER = path.join(REPO_ROOT, 'dist', 'server.cjs');

test('plugin manifest & mcp_config adhere to Antigravity schema', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugin.json'), 'utf8'));
  const allowedKeys = new Set([
    'name',
    'displayName',
    'version',
    'description',
    'logo',
    'suggestedPrompts',
    'author',
    'homepage',
    'repository',
    'disabled',
  ]);
  for (const k of Object.keys(manifest)) {
    assert.ok(allowedKeys.has(k), `Unexpected top-level field in plugin.json: ${k}`);
  }
  assert.equal(manifest.name, 'context-monitor');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, manifest.logo)), 'Logo asset must exist');

  const mcpCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'mcp_config.json'), 'utf8'));
  assert.ok(mcpCfg.mcpServers?.context_monitor, 'mcpServers.context_monitor must be configured');
  assert.equal(mcpCfg.mcpServers.context_monitor.command, 'node');
});

test('dist/app.html is self-contained, under 10 MiB, and syntactically valid JS', () => {
  assert.ok(fs.existsSync(DIST_HTML), 'dist/app.html must exist (run npm run build first)');
  const html = fs.readFileSync(DIST_HTML, 'utf8');
  assert.ok(html.length > 5000 && html.length < 10 * 1024 * 1024, 'HTML size must be reasonable');
  assert.ok(!html.includes('/*__APP_BUNDLE__*/'), 'Bundle placeholder must not leak');
  assert.ok(!/<script[^>]+src=/i.test(html), 'Must not reference external script URLs under default CSP');
  assert.ok(!/<link[^>]+href=["']https?:/i.test(html), 'Must not reference external stylesheet URLs');

  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'Inline <script> block must exist');
  assert.doesNotThrow(() => new Function(m[1]), 'Inlined JS must parse without syntax errors');
});

test('MCP stdio server parses mock multi-day transcripts, calculates pricing, and persists overrides', async () => {
  assert.ok(fs.existsSync(DIST_SERVER), 'dist/server.cjs must exist (run npm run build first)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-mon-test-'));
  const brainDir = path.join(tmpDir, 'brain');
  const dataDir = path.join(tmpDir, 'data');
  const logDir = path.join(brainDir, 'conv-test-001', '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const mockLines = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      created_at: '2026-11-26T09:00:00Z',
      content: '<USER_REQUEST>\n测试多日上下文监控\n</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-26T09:00:05Z',
      model: 'gemini-4-hydrogen-high',
      input_tokens: 10000,
      cache_read_tokens: 0,
      output_tokens: 1000,
      tool_calls: [{ name: 'read_file' }],
    }),
    JSON.stringify({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-27T02:00:00Z',
      model: 'gemini-4-neon-high',
      input_tokens: 5000,
      cache_read_tokens: 95000,
      output_tokens: 2000,
      tool_calls: [{ name: 'run_command' }],
    }),
    '{"broken_partial_line": true', // simulated in-progress write
  ];
  fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), mockLines.join('\n'), 'utf8');

  const child = spawn(process.execPath, [DIST_SERVER, `--data-dir=${dataDir}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ANTIGRAVITY_BRAIN_DIR: brainDir },
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  let buf = '';
  const responses = new Map();

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses.set(msg.id, msg);
      } catch {
        // ignore non-json
      }
    }
  });

  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const waitFor = (id, ms = 5000) => new Promise((res, rej) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(timer);
        res(responses.get(id));
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        rej(new Error(`Timeout waiting for RPC id ${id}; stderr=${stderr}`));
      }
    }, 25);
  });

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    });
    const initRes = await waitFor(1);
    assert.ok(initRes.result?.capabilities?.tools);
    assert.ok(initRes.result?.capabilities?.resources);
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolsRes = await waitFor(2);
    const openTool = toolsRes.result.tools.find((t) => t.name === 'open_context_monitor');
    assert.ok(openTool, 'open_context_monitor must be registered');
    assert.equal(openTool._meta?.ui?.resourceUri, 'ui://context-monitor/app.html');
    assert.equal(openTool._meta?.['com.google.antigravity/ui']?.entrypoints?.length, 2);

    send({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://context-monitor/app.html' } });
    const resRead = await waitFor(3);
    assert.equal(resRead.result.contents[0].mimeType, 'text/html;profile=mcp-app');

    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'open_context_monitor', arguments: {} } });
    const callRes = await waitFor(4);
    const sc = callRes.result.structuredContent;
    assert.equal(sc.detail.title, '测试多日上下文监控');
    assert.equal(sc.detail.currentContext, 100000);
    assert.equal(sc.detail.currentCacheHitRate, 0.95);
    assert.equal(sc.overview.dailyStats.length, 2);
    assert.equal(sc.overview.hourlyStats.length, 2);
    assert.equal(sc.overview.dailyStats[0].totalTokens, 11000);
    assert.equal(sc.overview.dailyStats[1].totalTokens, 102000);
    assert.equal(sc.overview.hourlyStats[1].totalTokens, 102000);
    // Hydrogen step: 10k*1.5/1e6 + 1k*7.5/1e6 = 0.015 + 0.0075 = 0.0225
    // Neon step: 5k*3/1e6 + 95k*0.15/1e6 + 2k*15/1e6 = 0.015 + 0.01425 + 0.03 = 0.05925
    assert.ok(Math.abs(sc.detail.cost.totalUsd - 0.08175) < 1e-6);

    // Test persistent custom pricing override
    send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'save_pricing_config',
        arguments: {
          currency: 'CNY',
          cnyRate: 7.5,
          overrides: { 'gemini-4-neon-high': { input: 6, cacheRead: 0.3, output: 30 } },
          conversationId: 'conv-test-001',
        },
      },
    });
    const saveRes = await waitFor(5);
    assert.equal(saveRes.result.structuredContent.pricingConfig.currency, 'CNY');
    assert.ok(fs.existsSync(path.join(dataDir, 'pricing.json')), 'pricing.json must persist in dataDir');
    // New Neon step = 2x = 0.1185; total = 0.0225 + 0.1185 = 0.141
    assert.ok(Math.abs(saveRes.result.structuredContent.detail.cost.totalUsd - 0.141) < 1e-6);
  } finally {
    child.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
