import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Antigravity Context Monitor', version: '1.2.0' }, {});

const state = {
  overview: null,
  selectedId: null,
  detail: null,
  pricingConfig: { currency: 'USD', cnyRate: 7.25, overrides: {} },
  pricingOpen: false,
  rangeMode: 'today', // today | 3d | 7d | 30d | all | custom
  customStart: '',
  customEnd: '',
  periodOpen: false,
  periodMetric: 'cost', // cost | tokens | calls
  refreshIntervalMs: 10000,
  limitMode: 'auto',
  search: '',
  timer: null,
  refreshing: false,
  connected: false,
  lastError: '',
};

const $ = (id) => document.getElementById(id);

function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

function fmtCompact(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtPct(ratio) {
  return `${(Number(ratio || 0) * 100).toFixed(1)}%`;
}

function fmtCost(usd) {
  const isCny = state.pricingConfig?.currency === 'CNY';
  const rate = Number(state.pricingConfig?.cnyRate) || 7.25;
  const val = isCny ? Number(usd || 0) * rate : Number(usd || 0);
  const sym = isCny ? '¥' : '$';
  if (val === 0) return `${sym}0.00`;
  if (val < 0.01) return `${sym}${val.toFixed(4)}`;
  if (val < 10) return `${sym}${val.toFixed(3)}`;
  return `${sym}${val.toFixed(2)}`;
}

function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function fmtRelTime(ms) {
  if (!ms) return '-';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  return `${Math.floor(hr / 24)}天前`;
}

function getLimit(conv) {
  if (state.limitMode !== 'auto') return Number(state.limitMode) || 1000000;
  return conv?.defaultContextLimit || 1000000;
}

function getLevelColor(ratio) {
  if (ratio >= 0.8) return 'var(--accent-danger)';
  if (ratio >= 0.55) return 'var(--accent-warn)';
  return 'var(--accent-ok)';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCurrencyBtn() {
  const isCny = state.pricingConfig?.currency === 'CNY';
  $('currencyBtn').textContent = isCny ? '¥ CNY' : '$ USD';
  $('pricingBtn').classList.toggle('active', state.pricingOpen);
}

function renderPricingDrawer() {
  const wrap = $('pricingDrawer');
  if (!state.pricingOpen) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';

  const models = state.overview?.knownModels || [];
  const rows = models.length === 0
    ? '<div class="muted small">暂未检测到本地模型记录</div>'
    : models.map((m) => {
        const tag = m.rate.source === 'custom'
          ? '<span class="badge">自定义</span>'
          : m.rate.source === 'preset'
            ? '<span class="badge badge-ok">参考价</span>'
            : '<span class="badge badge-warn">默认估算</span>';
        return `
          <div class="price-row" data-model="${escapeHtml(m.model)}">
            <div class="price-model">
              <strong>${escapeHtml(m.label)}</strong> ${tag}
              <div class="muted small"><code>${escapeHtml(m.model)}</code></div>
            </div>
            <label class="price-field"><span>输入</span><input type="number" step="0.01" min="0" data-field="input" value="${m.rate.input}" /></label>
            <label class="price-field"><span>缓存</span><input type="number" step="0.005" min="0" data-field="cacheRead" value="${m.rate.cacheRead}" /></label>
            <label class="price-field"><span>输出</span><input type="number" step="0.01" min="0" data-field="output" value="${m.rate.output}" /></label>
          </div>
        `;
      }).join('');

  wrap.innerHTML = `
    <div class="panel pricing-panel">
      <div class="panel-header">
        <div>
          <h2>模型参考单价设置（美元 / 1M tokens）</h2>
          <div class="subtitle">仅用于按 API 标价估算消耗参考，不代表订阅实际账单；保存后持久化生效</div>
        </div>
        <div class="controls">
          <label class="rate-inline">
            USD→CNY 汇率：
            <input id="cnyRateInput" type="number" step="0.01" min="0.1" value="${state.pricingConfig?.cnyRate || 7.25}" style="width:74px" />
          </label>
          <button id="resetPricingBtn">恢复默认</button>
          <button id="savePricingBtn" class="active">保存配置</button>
        </div>
      </div>
      <div class="pricing-body">${rows}</div>
    </div>
  `;

  $('savePricingBtn').addEventListener('click', async () => {
    const overrides = { ...(state.pricingConfig?.overrides || {}) };
    wrap.querySelectorAll('.price-row').forEach((row) => {
      const model = row.getAttribute('data-model');
      if (!model) return;
      const input = Number(row.querySelector('[data-field="input"]').value);
      const cacheRead = Number(row.querySelector('[data-field="cacheRead"]').value);
      const output = Number(row.querySelector('[data-field="output"]').value);
      if (Number.isFinite(input) && Number.isFinite(cacheRead) && Number.isFinite(output)) {
        overrides[model] = { input, cacheRead, output };
      }
    });
    const cnyRate = Number($('cnyRateInput').value) || 7.25;
    await persistPricing({
      currency: state.pricingConfig?.currency || 'USD',
      cnyRate,
      overrides,
    });
  });

  $('resetPricingBtn').addEventListener('click', async () => {
    await persistPricing({
      currency: state.pricingConfig?.currency || 'USD',
      cnyRate: 7.25,
      overrides: {},
    });
  });
}

async function persistPricing(nextCfg) {
  if (!state.connected) return;
  try {
    const res = await app.callServerTool({
      name: 'save_pricing_config',
      arguments: {
        ...nextCfg,
        conversationId: state.selectedId || '',
      },
    });
    const sc = res?.structuredContent;
    if (sc) {
      if (sc.pricingConfig) state.pricingConfig = sc.pricingConfig;
      if (sc.overview) state.overview = sc.overview;
      if (sc.detail) state.detail = sc.detail;
      state.lastError = '';
      renderAll();
    }
  } catch (err) {
    state.lastError = `保存单价失败：${err?.message || String(err)}`;
    updateFooter();
  }
}

function localDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDateKey(baseKey, offsetDays) {
  const [y, m, d] = baseKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offsetDays);
  return localDateKey(dt);
}

function getRangeBounds() {
  const todayKey = state.overview?.todayKey || localDateKey(new Date());
  if (state.rangeMode === 'today') {
    return { start: todayKey, end: todayKey, label: '今日', fillDays: 1 };
  }
  if (state.rangeMode === '3d') {
    return { start: shiftDateKey(todayKey, -2), end: todayKey, label: '近 3 天', fillDays: 3 };
  }
  if (state.rangeMode === '7d') {
    return { start: shiftDateKey(todayKey, -6), end: todayKey, label: '近 7 天', fillDays: 7 };
  }
  if (state.rangeMode === '30d') {
    return { start: shiftDateKey(todayKey, -29), end: todayKey, label: '近 30 天', fillDays: 30 };
  }
  if (state.rangeMode === 'custom') {
    let s = state.customStart || todayKey;
    let e = state.customEnd || todayKey;
    if (s > e) [s, e] = [e, s];
    return { start: s, end: e, label: s === e ? s : `${s.slice(5)} ~ ${e.slice(5)}`, fillDays: 0 };
  }
  return { start: null, end: null, label: '全部历史', fillDays: 0 };
}

function computePeriodStats() {
  const dailyStats = state.overview?.dailyStats || [];
  const bounds = getRangeBounds();
  const matched = dailyStats.filter((d) => {
    if (bounds.start && d.date < bounds.start) return false;
    if (bounds.end && d.date > bounds.end) return false;
    return true;
  });

  const convSet = new Set();
  const modelMap = new Map();
  const agg = {
    label: bounds.label,
    start: bounds.start,
    end: bounds.end,
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    cacheSavedUsd: 0,
    daysWithData: matched.length,
  };

  const byDate = new Map();
  for (const d of matched) {
    byDate.set(d.date, d);
    agg.calls += d.calls || 0;
    agg.inputTokens += d.inputTokens || 0;
    agg.cacheReadTokens += d.cacheReadTokens || 0;
    agg.outputTokens += d.outputTokens || 0;
    agg.costUsd += d.costUsd || 0;
    agg.cacheSavedUsd += d.cacheSavedUsd || 0;
    for (const cid of (d.conversationIds || [])) convSet.add(cid);
    for (const m of (d.models || [])) {
      const prev = modelMap.get(m.model) || {
        model: m.model,
        label: m.label,
        calls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      prev.calls += m.calls || 0;
      prev.inputTokens += m.inputTokens || 0;
      prev.cacheReadTokens += m.cacheReadTokens || 0;
      prev.outputTokens += m.outputTokens || 0;
      prev.costUsd += m.costUsd || 0;
      modelMap.set(m.model, prev);
    }
  }

  // Build continuous series for fixed-day presets so empty days render honestly
  let series = [];
  if (bounds.fillDays > 1 && bounds.start) {
    for (let i = 0; i < bounds.fillDays; i++) {
      const dk = shiftDateKey(bounds.start, i);
      series.push(byDate.get(dk) || {
        date: dk,
        calls: 0,
        conversationCount: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        cacheSavedUsd: 0,
      });
    }
  } else {
    series = matched;
  }

  const promptTotal = agg.inputTokens + agg.cacheReadTokens;
  agg.cacheHitRate = promptTotal > 0 ? agg.cacheReadTokens / promptTotal : 0;
  agg.conversationCount = convSet.size;
  agg.models = Array.from(modelMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  agg.series = series;
  agg.matched = matched;
  return agg;
}

function renderRangeBar() {
  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-range') === state.rangeMode);
  });
  $('togglePeriodBtn').classList.toggle('active', state.periodOpen);
  const todayKey = state.overview?.todayKey || localDateKey(new Date());
  if (!$('startDateInput').value) $('startDateInput').value = state.customStart || shiftDateKey(todayKey, -6);
  if (!$('endDateInput').value) $('endDateInput').value = state.customEnd || todayKey;
}

function renderSummary() {
  const s = state.overview?.summary;
  if (!s) return;
  const p = computePeriodStats();
  $('summaryStrip').innerHTML = `
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}调用</div>
      <div class="value">${fmtNum(p.calls)} 次</div>
      <div class="sub">新增 ${fmtCompact(p.inputTokens)} · 输出 ${fmtCompact(p.outputTokens)}</div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}参考费用</div>
      <div class="value cost-val">${fmtCost(p.costUsd)}</div>
      <div class="sub">缓存约省 <strong class="live-tag">${fmtCost(p.cacheSavedUsd)}</strong></div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}缓存命中率</div>
      <div class="value">${fmtPct(p.cacheHitRate)}</div>
      <div class="sub">缓存读取 ${fmtCompact(p.cacheReadTokens)}</div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}活跃会话 / 全部累计</div>
      <div class="value">${p.conversationCount} 个 <span class="muted small">/ 共 ${s.conversationCount}</span></div>
      <div class="sub">全部累计参考费用 <span class="cost-inline">${fmtCost(s.totalCostUsd)}</span></div>
    </div>
  `;
}

function renderPeriodBarChart(series) {
  if (!series || series.length === 0) {
    return '<div class="empty">所选时间范围内暂无消耗记录</div>';
  }
  const W = 720;
  const H = 165;
  const padL = 54;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const valOf = (d) => {
    if (state.periodMetric === 'tokens') return (d.inputTokens || 0) + (d.outputTokens || 0);
    if (state.periodMetric === 'calls') return d.calls || 0;
    return d.costUsd || 0;
  };
  const fmtTick = (v) => {
    if (state.periodMetric === 'tokens') return fmtCompact(Math.round(v));
    if (state.periodMetric === 'calls') return String(Math.round(v));
    return fmtCost(v);
  };

  const maxVal = Math.max(
    state.periodMetric === 'cost' ? 0.01 : 1,
    ...series.map(valOf)
  ) * 1.15;

  const slotW = plotW / series.length;
  const barW = Math.max(4, Math.min(34, slotW * 0.65));

  const yTicks = [0, 0.5, 1].map((t) => {
    const val = maxVal * t;
    const y = padT + plotH - t * plotH;
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3,3" />
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--text-muted)">${escapeHtml(fmtTick(val))}</text>
    `;
  }).join('');

  const labelStep = Math.max(1, Math.ceil(series.length / 8));
  const bars = series.map((d, i) => {
    const v = valOf(d);
    const h = Math.max(v > 0 ? 2 : 0, (v / maxVal) * plotH);
    const x = padL + i * slotW + (slotW - barW) / 2;
    const y = padT + plotH - h;
    const fill = state.periodMetric === 'cost' ? 'var(--accent-warn)' : 'var(--accent-primary)';
    const showLabel = i % labelStep === 0 || i === series.length - 1;
    const cx = padL + i * slotW + slotW / 2;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}" opacity="${v > 0 ? '0.9' : '0.18'}">
        <title>${d.date} | 调用: ${d.calls} 次 | 新增输入: ${fmtNum(d.inputTokens)} | 缓存: ${fmtNum(d.cacheReadTokens)} | 输出: ${fmtNum(d.outputTokens)} | 参考费用: ${fmtCost(d.costUsd)} (省 ${fmtCost(d.cacheSavedUsd)})</title>
      </rect>
      ${showLabel ? `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--text-muted)">${d.date.slice(5)}</text>` : ''}
    `;
  }).join('');

  return `
    <svg class="bar-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${yTicks}
      ${bars}
    </svg>
  `;
}

function renderPeriodSection() {
  const sec = $('periodSection');
  if (!state.periodOpen || !state.overview) {
    sec.classList.remove('open');
    return;
  }
  sec.classList.add('open');

  const p = computePeriodStats();
  const modelChips = p.models.map((m) => `
    <span class="chip">
      <strong>${escapeHtml(m.label)}</strong>
      <span>${m.calls}次</span>
      <span>${fmtCompact(m.inputTokens + m.outputTokens)}</span>
      <span class="cost-inline">${fmtCost(m.costUsd)}</span>
    </span>
  `).join('');

  const tableRows = [...p.matched].reverse().map((d) => `
    <tr>
      <td><strong>${escapeHtml(d.date)}</strong></td>
      <td class="num">${d.conversationCount}</td>
      <td class="num">${d.calls}</td>
      <td class="num">${fmtNum(d.inputTokens)}</td>
      <td class="num">${fmtNum(d.cacheReadTokens)}</td>
      <td class="num">${fmtNum(d.outputTokens)}</td>
      <td class="num"><span class="cost-inline">${fmtCost(d.costUsd)}</span></td>
      <td class="num"><span class="live-tag">${fmtCost(d.cacheSavedUsd)}</span></td>
    </tr>
  `).join('');

  sec.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(p.label)}每日消耗趋势（有记录 ${p.daysWithData} 天）</h2>
          <div class="subtitle">悬停柱子可查看当天 Token 与费用详情</div>
        </div>
        <div class="controls">
          <button class="metric-btn ${state.periodMetric === 'cost' ? 'active' : ''}" data-metric="cost">按费用</button>
          <button class="metric-btn ${state.periodMetric === 'tokens' ? 'active' : ''}" data-metric="tokens">按非缓存 Token</button>
          <button class="metric-btn ${state.periodMetric === 'calls' ? 'active' : ''}" data-metric="calls">按调用次数</button>
          <button id="copyPeriodMdBtn" title="复制 Markdown 周期统计报表">复制报表</button>
          <button id="exportPeriodCsvBtn" title="导出 Excel 兼容 CSV 明细">导出 CSV</button>
        </div>
      </div>
      <div class="chart-wrap">${renderPeriodBarChart(p.series)}</div>
      ${modelChips ? `<div class="chips chips-tight">${modelChips}</div>` : ''}
      <div class="period-table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th class="num">会话数</th>
              <th class="num">调用次数</th>
              <th class="num">新增输入</th>
              <th class="num">缓存读取</th>
              <th class="num">输出</th>
              <th class="num">参考费用</th>
              <th class="num">缓存约省</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="8" class="empty">该时间段内暂无记录</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  sec.querySelectorAll('.metric-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.periodMetric = btn.getAttribute('data-metric') || 'cost';
      renderPeriodSection();
    });
  });

  const copyBtn = $('copyPeriodMdBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const mdLines = [
        `### Antigravity 上下文与费用统计（${p.label}）`,
        `- 调用次数：${fmtNum(p.calls)} 次（活跃会话 ${p.conversationCount} 个）`,
        `- 新增输入 / 缓存读取 / 输出：${fmtNum(p.inputTokens)} / ${fmtNum(p.cacheReadTokens)} / ${fmtNum(p.outputTokens)}`,
        `- 参考费用：${fmtCost(p.costUsd)}（缓存约省 ${fmtCost(p.cacheSavedUsd)}，命中率 ${fmtPct(p.cacheHitRate)}）`,
        '',
        '| 日期 | 会话数 | 调用 | 新增输入 | 缓存读取 | 输出 | 参考费用 | 缓存约省 |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...[...p.matched].reverse().map((d) =>
          `| ${d.date} | ${d.conversationCount} | ${d.calls} | ${fmtNum(d.inputTokens)} | ${fmtNum(d.cacheReadTokens)} | ${fmtNum(d.outputTokens)} | ${fmtCost(d.costUsd)} | ${fmtCost(d.cacheSavedUsd)} |`
        ),
      ].join('\n');
      try {
        await navigator.clipboard.writeText(mdLines);
        copyBtn.textContent = '已复制';
        setTimeout(() => { copyBtn.textContent = '复制报表'; }, 1800);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = mdLines;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          copyBtn.textContent = '已复制';
          setTimeout(() => { copyBtn.textContent = '复制报表'; }, 1800);
        } catch {
          state.lastError = '当前沙盒限制剪贴板写入，可改用“导出 CSV”';
          updateFooter();
        }
        document.body.removeChild(ta);
      }
    });
  }

  const csvBtn = $('exportPeriodCsvBtn');
  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      const isCny = state.pricingConfig?.currency === 'CNY';
      const rate = Number(state.pricingConfig?.cnyRate) || 7.25;
      const unit = isCny ? 'CNY' : 'USD';
      const conv = (usd) => (isCny ? (usd * rate).toFixed(4) : usd.toFixed(4));
      const rows = [
        ['日期', '会话数', '调用次数', '新增输入Token', '缓存读取Token', '输出Token', `参考费用(${unit})`, `缓存约省(${unit})`],
        ...[...p.matched].reverse().map((d) => [
          d.date,
          d.conversationCount,
          d.calls,
          d.inputTokens,
          d.cacheReadTokens,
          d.outputTokens,
          conv(d.costUsd || 0),
          conv(d.cacheSavedUsd || 0),
        ]),
      ];
      const csv = '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `antigravity-usage-${state.rangeMode}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}

function renderConversationControls() {
  const list = state.overview?.conversations || [];
  const q = state.search.trim().toLowerCase();
  const filtered = q
    ? list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.currentModelLabel || '').toLowerCase().includes(q)
      )
    : list;

  const picker = $('convSelect');
  if (picker) {
    picker.innerHTML = list.length === 0
      ? '<option value="">暂无本地会话</option>'
      : list.map((c) => {
          const limit = getLimit(c);
          const pct = fmtPct(c.currentContext / limit);
          const sel = c.id === state.selectedId ? 'selected' : '';
          return `<option value="${escapeHtml(c.id)}" ${sel}>${c.isActive ? '● ' : ''}${escapeHtml(c.title.slice(0, 24))} (${fmtCompact(c.currentContext)} · ${pct} · ${fmtCost(c.cost?.totalUsd)})</option>`;
        }).join('');
  }

  $('convCountBadge').textContent = String(filtered.length);
  if (filtered.length === 0) {
    $('convList').innerHTML = '<div class="empty">没有匹配的会话日志</div>';
    return;
  }

  $('convList').innerHTML = filtered.map((c) => {
    const limit = getLimit(c);
    const ratio = Math.min(1, c.currentContext / limit);
    const color = getLevelColor(ratio);
    const selected = c.id === state.selectedId ? 'selected' : '';
    return `
      <div class="conv-item ${selected}" data-id="${escapeHtml(c.id)}">
        <div class="conv-title">${escapeHtml(c.title)}</div>
        <div class="conv-meta">
          <span>${c.isActive ? '<strong class="live-tag">● 活跃</strong> · ' : ''}${escapeHtml(c.currentModelLabel || '暂无调用')}</span>
          <span>${fmtRelTime(c.updatedAtMs)}</span>
        </div>
        <div class="conv-meta">
          <span>上下文 <strong>${fmtCompact(c.currentContext)}</strong> (${fmtPct(c.currentContext / limit)})</span>
          <span class="cost-inline">${fmtCost(c.cost?.totalUsd)}</span>
        </div>
        <div class="mini-bar">
          <div class="mini-bar-fill" style="width:${(ratio * 100).toFixed(1)}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.conv-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      if (id && id !== state.selectedId) {
        state.selectedId = id;
        renderConversationControls();
        fetchDetail(id);
      }
    });
  });
}

function renderChart(steps, limit) {
  if (!steps || steps.length === 0) {
    return '<div class="empty">该会话还没有模型调用记录</div>';
  }
  const W = 720;
  const H = 190;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(10000, ...steps.map((s) => s.contextTokens)) * 1.12;
  const xFor = (i) => (steps.length === 1 ? padL + plotW / 2 : padL + (i / (steps.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const ctxPoints = steps.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.contextTokens).toFixed(1)}`).join(' ');
  const cachePoints = steps.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.cacheReadTokens).toFixed(1)}`).join(' ');
  const areaPath =
    `M ${xFor(0).toFixed(1)},${(padT + plotH).toFixed(1)} ` +
    steps.map((s, i) => `L ${xFor(i).toFixed(1)},${yFor(s.contextTokens).toFixed(1)}`).join(' ') +
    ` L ${xFor(steps.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const val = maxVal * t;
    const y = yFor(val);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3,3" />
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${fmtCompact(Math.round(val))}</text>
    `;
  }).join('');

  const dots = steps.map((s, i) => {
    const cx = xFor(i).toFixed(1);
    const cy = yFor(s.contextTokens).toFixed(1);
    const fill = s.isCompactionDrop ? 'var(--accent-warn)' : 'var(--accent-primary)';
    return `<circle cx="${cx}" cy="${cy}" r="${steps.length > 35 ? 2.5 : 3.5}" fill="${fill}">
      <title>Step ${s.stepIndex} | 上下文: ${fmtNum(s.contextTokens)} | 缓存: ${fmtNum(s.cacheReadTokens)} | 新增输入: ${fmtNum(s.inputTokens)} | 输出: ${fmtNum(s.outputTokens)} | 费用: ${fmtCost(s.costUsd)}</title>
    </circle>`;
  }).join('');

  const xLabels = [0, Math.floor((steps.length - 1) / 2), steps.length - 1]
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .map((i) => `<text x="${xFor(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">Step ${steps[i].stepIndex}</text>`)
    .join('');

  return `
    <div class="chart-legend">
      <span class="legend-item"><span class="swatch" style="background:var(--accent-primary)"></span>总上下文</span>
      <span class="legend-item"><span class="swatch" style="background:var(--accent-ok)"></span>缓存命中</span>
      <span class="legend-item"><span class="swatch" style="background:var(--accent-warn)"></span>压缩回落</span>
      <span class="legend-right">上限 ${fmtCompact(limit)}</span>
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${yTicks}
      <path d="${areaPath}" fill="var(--accent-primary-soft)" />
      <polyline fill="none" stroke="var(--accent-ok)" stroke-width="1.8" stroke-dasharray="4,3" points="${cachePoints}" />
      <polyline fill="none" stroke="var(--accent-primary)" stroke-width="2.4" points="${ctxPoints}" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

function renderDetail() {
  const d = state.detail;
  if (!d) {
    $('detailArea').innerHTML = '<div class="panel"><div class="empty">暂无会话数据</div></div>';
    return;
  }

  const limit = getLimit(d);
  const ratio = d.currentContext / limit;
  const clamped = Math.min(1, ratio);
  const color = getLevelColor(ratio);
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - clamped);
  const cost = d.cost || { inputUsd: 0, cacheUsd: 0, outputUsd: 0, totalUsd: 0, cacheSavedUsd: 0 };

  const modelsHtml = (d.models || []).map((m) => `
    <span class="chip">
      <strong>${escapeHtml(m.label)}</strong>
      <span>${m.calls}次</span>
      <span>峰值 ${fmtCompact(m.maxContext)}</span>
      <span class="cost-inline">${fmtCost(m.costTotalUsd)}</span>
    </span>
  `).join('');

  const toolsHtml = (d.topTools || []).map((t) => `
    <span class="chip"><code>${escapeHtml(t.name)}</code> <strong>×${t.count}</strong></span>
  `).join('');

  const rowsHtml = [...(d.steps || [])].reverse().map((s) => `
    <tr>
      <td>#${s.stepIndex}${s.isCompactionDrop ? '<span class="tag-compact">压缩</span>' : ''}</td>
      <td>${fmtTime(s.createdAt)}</td>
      <td class="col-model">${escapeHtml(s.modelLabel)}</td>
      <td class="num"><strong>${fmtNum(s.contextTokens)}</strong></td>
      <td class="num">${fmtNum(s.inputTokens)}</td>
      <td class="num">${fmtNum(s.cacheReadTokens)} <span class="muted">(${fmtPct(s.cacheHitRate)})</span></td>
      <td class="num">${fmtNum(s.outputTokens)}</td>
      <td class="num"><span class="cost-inline">${fmtCost(s.costUsd)}</span></td>
      <td>${(s.tools || []).map((t) => `<span class="tag-tool">${escapeHtml(t)}</span>`).join('') || '<span class="muted">回复</span>'}</td>
    </tr>
  `).join('');

  $('detailArea').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="title-block">
          <h2>${escapeHtml(d.title)}</h2>
          <div class="subtitle">ID: <code>${escapeHtml(d.id.slice(0, 12))}</code> · 更新于 ${fmtDateTime(d.updatedAt)}</div>
        </div>
        <span class="badge ${d.isActive ? 'badge-ok' : ''}">${d.isActive ? '活跃' : '空闲'}</span>
      </div>

      <div class="hero-grid">
        <div class="gauge-box">
          <div class="gauge-wrap">
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r="${radius}" fill="none" stroke="var(--border)" stroke-width="11" />
              <circle cx="66" cy="66" r="${radius}" fill="none" stroke="${color}" stroke-width="11"
                stroke-linecap="round"
                stroke-dasharray="${circ.toFixed(1)}"
                stroke-dashoffset="${dashOffset.toFixed(1)}"
                transform="rotate(-90 66 66)" />
            </svg>
            <div class="gauge-center">
              <div class="gauge-pct" style="color:${color}">${fmtPct(ratio)}</div>
              <div class="gauge-sub">${fmtCompact(d.currentContext)} / ${fmtCompact(limit)}</div>
            </div>
          </div>
          <div class="gauge-caption">当前上下文水位（峰值 ${fmtCompact(d.peakContext)}）</div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="k-label">本会话参考费用</div>
            <div class="k-val cost-val">${fmtCost(cost.totalUsd)}</div>
            <div class="k-sub">入 ${fmtCost(cost.inputUsd)} · 缓 ${fmtCost(cost.cacheUsd)} · 出 ${fmtCost(cost.outputUsd)}</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">缓存约省费用</div>
            <div class="k-val live-tag">${fmtCost(cost.cacheSavedUsd)}</div>
            <div class="k-sub">平均命中率 ${fmtPct(d.avgCacheHitRate)}</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">当前上下文</div>
            <div class="k-val">${fmtNum(d.currentContext)}</div>
            <div class="k-sub">最新命中 ${fmtPct(d.currentCacheHitRate)}</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">累计新增输入 / 输出</div>
            <div class="k-val">${fmtCompact(d.totals.inputTokens)} / ${fmtCompact(d.totals.outputTokens)}</div>
            <div class="k-sub">缓存读取 ${fmtCompact(d.totals.cacheReadTokens)}</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">调用 / 轮次</div>
            <div class="k-val">${d.modelCalls} 次 / ${d.userTurns} 轮</div>
            <div class="k-sub">压缩回落 ${d.compactionCount} 次</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">当前模型</div>
            <div class="k-val model-val">${escapeHtml(d.currentModelLabel || '暂无')}</div>
            <div class="k-sub">日志 ${(d.fileSizeBytes / 1024).toFixed(1)} KB</div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>上下文增长趋势</h2>
        <span class="muted small">悬停圆点查看单步 Token 与费用</span>
      </div>
      <div class="chart-wrap">${renderChart(d.steps, limit)}</div>
    </div>

    <div class="panel">
      <div class="panel-header"><h2>模型费用分布与高频工具</h2></div>
      <div class="chips">${modelsHtml || '<span class="muted small">暂无统计</span>'}</div>
      ${toolsHtml ? `<div class="chips chips-tight">${toolsHtml}</div>` : ''}
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>逐次调用 Token 与费用明细</h2>
        <span class="badge">${(d.steps || []).length} 条</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>时间</th>
              <th class="col-model">模型</th>
              <th class="num">当前上下文</th>
              <th class="num">新增输入</th>
              <th class="num">缓存读取</th>
              <th class="num">输出</th>
              <th class="num">参考费用</th>
              <th>动作 / 工具</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="9" class="empty">暂无记录</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function updateFooter() {
  if (state.lastError) {
    $('footerNote').textContent = `提示：${state.lastError}`;
    return;
  }
  const gen = state.overview?.generatedAt ? fmtDateTime(state.overview.generatedAt) : '-';
  const freq = state.refreshIntervalMs > 0 ? `每 ${state.refreshIntervalMs / 1000} 秒` : '已关闭';
  $('footerNote').textContent = `只读本地日志 · 自动刷新：${freq} · 费用按公开 API 参考价估算 · 最近刷新：${gen}`;
}

function renderAll() {
  renderCurrencyBtn();
  renderPricingDrawer();
  renderRangeBar();
  renderSummary();
  renderPeriodSection();
  renderConversationControls();
  renderDetail();
  updateFooter();
}

async function fetchDetail(convId) {
  if (!convId || !state.connected) return;
  try {
    const res = await app.callServerTool({
      name: 'get_conversation_detail',
      arguments: { conversationId: convId },
    });
    if (res?.structuredContent) {
      state.detail = res.structuredContent;
      state.lastError = '';
      renderDetail();
      updateFooter();
    }
  } catch (err) {
    state.lastError = err?.message || String(err);
    updateFooter();
  }
}

async function refreshAll() {
  if (!state.connected || state.refreshing) return;
  state.refreshing = true;
  try {
    const res = await app.callServerTool({
      name: 'get_monitor_overview',
      arguments: {},
    });
    if (res?.structuredContent) {
      const sc = res.structuredContent;
      if (sc.pricingConfig) state.pricingConfig = sc.pricingConfig;
      state.overview = sc;
      const list = state.overview.conversations || [];
      if (!state.selectedId && list.length > 0) {
        state.selectedId = list[0].id;
      } else if (state.selectedId && !list.some((c) => c.id === state.selectedId) && list.length > 0) {
        state.selectedId = list[0].id;
      }
      renderCurrencyBtn();
      renderRangeBar();
      renderSummary();
      renderPeriodSection();
      renderConversationControls();
      state.lastError = '';
      if (state.selectedId) {
        await fetchDetail(state.selectedId);
      } else {
        renderDetail();
      }
      updateFooter();
    }
  } catch (err) {
    state.lastError = err?.message || String(err);
    updateFooter();
  } finally {
    state.refreshing = false;
  }
}

function setupPolling() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  $('liveDot').style.opacity = state.refreshIntervalMs > 0 ? '1' : '0.35';
  if (state.refreshIntervalMs > 0) {
    state.timer = setInterval(refreshAll, state.refreshIntervalMs);
  }
  updateFooter();
}

function applyHostContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.setAttribute('data-theme', ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function bindControls() {
  $('limitSelect').addEventListener('change', (e) => {
    state.limitMode = e.target.value;
    renderConversationControls();
    renderDetail();
  });

  $('convSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (id && id !== state.selectedId) {
      state.selectedId = id;
      renderConversationControls();
      fetchDetail(id);
    }
  });

  $('refreshIntervalSelect').value = String(state.refreshIntervalMs);
  $('refreshIntervalSelect').addEventListener('change', (e) => {
    state.refreshIntervalMs = Number(e.target.value) || 0;
    setupPolling();
  });

  $('currencyBtn').addEventListener('click', async () => {
    const nextCurrency = state.pricingConfig?.currency === 'CNY' ? 'USD' : 'CNY';
    state.pricingConfig = { ...state.pricingConfig, currency: nextCurrency };
    renderAll();
    await persistPricing(state.pricingConfig);
  });

  $('pricingBtn').addEventListener('click', () => {
    state.pricingOpen = !state.pricingOpen;
    renderCurrencyBtn();
    renderPricingDrawer();
  });

  $('refreshBtn').addEventListener('click', () => {
    refreshAll();
  });

  $('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderConversationControls();
  });

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-range') || 'today';
      state.rangeMode = next;
      if (next !== 'today') state.periodOpen = true;
      renderRangeBar();
      renderSummary();
      renderPeriodSection();
    });
  });

  const onCustomDate = () => {
    state.customStart = $('startDateInput').value;
    state.customEnd = $('endDateInput').value;
    state.rangeMode = 'custom';
    state.periodOpen = true;
    renderRangeBar();
    renderSummary();
    renderPeriodSection();
  };
  $('startDateInput').addEventListener('change', onCustomDate);
  $('endDateInput').addEventListener('change', onCustomDate);

  $('togglePeriodBtn').addEventListener('click', () => {
    state.periodOpen = !state.periodOpen;
    renderRangeBar();
    renderPeriodSection();
  });
}

app.ontoolinput = () => {
  $('footerNote').textContent = '正在加载本地会话日志...';
};

app.ontoolresult = (result) => {
  const sc = result?.structuredContent;
  if (!sc) return;
  if (sc.pricingConfig) state.pricingConfig = sc.pricingConfig;
  if (sc.overview) state.overview = sc.overview;
  if (sc.selectedId) state.selectedId = sc.selectedId;
  if (sc.detail) state.detail = sc.detail;
  renderAll();
};

app.onhostcontextchanged = (ctx) => {
  applyHostContext(ctx);
};

window.addEventListener('error', (e) => {
  const note = $('footerNote');
  if (note) note.textContent = `运行错误：${e.message || '未知错误'}`;
});

window.addEventListener('unhandledrejection', (e) => {
  const note = $('footerNote');
  if (note) note.textContent = `异步错误：${e.reason?.message || String(e.reason || '未知错误')}`;
});

async function init() {
  bindControls();
  $('footerNote').textContent = '正在连接 Antigravity 宿主...';
  await app.connect();
  state.connected = true;
  applyHostContext(app.getHostContext());
  if (!state.overview) {
    await refreshAll();
  }
  setupPolling();
}

init().catch((err) => {
  $('detailArea').innerHTML = `<div class="panel"><div class="empty">插件初始化失败：${escapeHtml(err?.message || String(err))}</div></div>`;
});
