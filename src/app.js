import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Antigravity Context Monitor', version: '1.3.0' }, {});

const state = {
  overview: null,
  selectedId: null,
  detail: null,
  pricingConfig: { currency: 'USD', cnyRate: 7.25, overrides: {} },
  pricingOpen: false,
  rangeMode: 'today', // today | 3d | 7d | 30d | all | custom
  customStart: '',
  customEnd: '',
  periodOpen: true,
  periodTableOpen: false,
  periodMetric: 'tokens', // tokens | calls | cost
  granularity: 'auto', // auto | hour | day
  ctxChartOpen: null, // null = auto (collapsed in narrow pane, open in wide view)
  ctxWindow: '30', // '30' | '100' | 'all'
  stepPage: 1,
  stepPageSize: 10, // 10 | 20 | 50 | 0 (all)
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

function fmtCnTokens(n) {
  const v = Number(n || 0);
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(2)}亿`;
  if (v >= 10_000) {
    const w = v / 10_000;
    return w >= 100 ? `${Math.round(w)}万` : `${w.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
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
    return { start: todayKey, end: todayKey, label: '当天', fillDays: 1 };
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
    const [sy, sm, sd] = s.split('-').map(Number);
    const [ey, em, ed] = e.split('-').map(Number);
    const spanDays = Math.round((new Date(ey, em - 1, ed) - new Date(sy, sm - 1, sd)) / 86400000) + 1;
    return { start: s, end: e, label: s === e ? s : `${s.slice(5)} ~ ${e.slice(5)}`, fillDays: spanDays };
  }
  return { start: null, end: null, label: '全部历史', fillDays: 0 };
}

function resolveEffectiveGranularity(bounds) {
  const canHourly = bounds.fillDays >= 1 && bounds.fillDays <= 3 && Boolean(bounds.start && bounds.end);
  if (!canHourly) return { mode: 'day', canHourly: false };
  if (state.granularity === 'hour') return { mode: 'hour', canHourly: true };
  if (state.granularity === 'day') return { mode: 'day', canHourly: true };
  return { mode: bounds.fillDays === 1 ? 'hour' : 'day', canHourly: true };
}

function buildHourlySeries(bounds) {
  const hourlyStats = state.overview?.hourlyStats || [];
  const byHour = new Map();
  for (const h of hourlyStats) {
    if (bounds.start && h.date < bounds.start) continue;
    if (bounds.end && h.date > bounds.end) continue;
    byHour.set(h.hour, h);
  }

  const todayKey = state.overview?.todayKey || localDateKey(new Date());
  const nowHour = typeof state.overview?.currentHour === 'number'
    ? state.overview.currentHour
    : new Date().getHours();

  const series = [];
  for (let dIdx = 0; dIdx < bounds.fillDays; dIdx++) {
    const dk = shiftDateKey(bounds.start, dIdx);
    const maxHr = dk === todayKey ? Math.max(nowHour, 0) : 23;
    for (let hr = 0; hr <= maxHr; hr++) {
      const hh = String(hr).padStart(2, '0');
      const key = `${dk} ${hh}:00`;
      const existing = byHour.get(key);
      const shortLabel = `${dk.slice(5).replace('-', '/')} ${hh}:00`;
      series.push(existing
        ? { ...existing, key, label: shortLabel }
        : {
            key,
            hour: key,
            date: dk,
            label: shortLabel,
            calls: 0,
            conversationCount: 0,
            inputTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            cacheSavedUsd: 0,
          });
    }
  }
  return series;
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
    totalTokens: 0,
    costUsd: 0,
    cacheSavedUsd: 0,
    daysWithData: matched.length,
  };

  const byDate = new Map();
  for (const d of matched) {
    const totalTok = typeof d.totalTokens === 'number'
      ? d.totalTokens
      : (d.inputTokens || 0) + (d.cacheReadTokens || 0) + (d.outputTokens || 0);
    const normalized = { ...d, totalTokens: totalTok, key: d.date, label: d.date.slice(5).replace('-', '/') };
    byDate.set(d.date, normalized);
    agg.calls += d.calls || 0;
    agg.inputTokens += d.inputTokens || 0;
    agg.cacheReadTokens += d.cacheReadTokens || 0;
    agg.outputTokens += d.outputTokens || 0;
    agg.totalTokens += totalTok;
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
        totalTokens: 0,
        costUsd: 0,
      };
      prev.calls += m.calls || 0;
      prev.inputTokens += m.inputTokens || 0;
      prev.cacheReadTokens += m.cacheReadTokens || 0;
      prev.outputTokens += m.outputTokens || 0;
      prev.totalTokens += (m.inputTokens || 0) + (m.cacheReadTokens || 0) + (m.outputTokens || 0);
      prev.costUsd += m.costUsd || 0;
      modelMap.set(m.model, prev);
    }
  }

  const gran = resolveEffectiveGranularity(bounds);
  let series = [];
  if (gran.mode === 'hour') {
    series = buildHourlySeries(bounds);
  } else if (bounds.fillDays > 1 && bounds.fillDays <= 60 && bounds.start) {
    for (let i = 0; i < bounds.fillDays; i++) {
      const dk = shiftDateKey(bounds.start, i);
      series.push(byDate.get(dk) || {
        key: dk,
        date: dk,
        label: dk.slice(5).replace('-', '/'),
        calls: 0,
        conversationCount: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        cacheSavedUsd: 0,
      });
    }
  } else {
    series = matched.map((d) => byDate.get(d.date));
  }

  const promptTotal = agg.inputTokens + agg.cacheReadTokens;
  agg.cacheHitRate = promptTotal > 0 ? agg.cacheReadTokens / promptTotal : 0;
  agg.conversationCount = convSet.size;
  agg.models = Array.from(modelMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  agg.series = series;
  agg.matched = matched.map((d) => byDate.get(d.date));
  agg.granularity = gran.mode;
  agg.canHourly = gran.canHourly;
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
      <div class="label">${escapeHtml(p.label)}总 Token</div>
      <div class="value">${fmtCnTokens(p.totalTokens)}</div>
      <div class="sub">入 ${fmtCompact(p.inputTokens)} · 缓 ${fmtCompact(p.cacheReadTokens)} · 出 ${fmtCompact(p.outputTokens)}</div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}请求次数</div>
      <div class="value">${fmtNum(p.calls)} 次</div>
      <div class="sub">活跃会话 ${p.conversationCount} 个 / 共 ${s.conversationCount}</div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}参考成本</div>
      <div class="value cost-val">${fmtCost(p.costUsd)}</div>
      <div class="sub">全部累计成本 <span class="cost-inline">${fmtCost(s.totalCostUsd)}</span></div>
    </div>
    <div class="stat-mini">
      <div class="label">${escapeHtml(p.label)}缓存命中率</div>
      <div class="value">${fmtPct(p.cacheHitRate)}</div>
      <div class="sub">缓存读取 ${fmtCnTokens(p.cacheReadTokens)}</div>
    </div>
  `;
}

function computeNiceMax(rawMax, isCost) {
  if (rawMax <= 0) return isCost ? 0.1 : 10;
  const exp = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / exp;
  let nice = 10;
  if (norm <= 1.2) nice = 1.2;
  else if (norm <= 1.5) nice = 1.5;
  else if (norm <= 2) nice = 2;
  else if (norm <= 3) nice = 3;
  else if (norm <= 5) nice = 5;
  else if (norm <= 6) nice = 6;
  else if (norm <= 8) nice = 8;
  return nice * exp;
}

function getChartWidth(fallback = 640) {
  const sec = $('periodSection');
  const detail = $('detailArea');
  const w = (sec && sec.clientWidth) || (detail && detail.clientWidth) || window.innerWidth || fallback;
  return Math.max(300, Math.round(w - 28));
}

function renderPeriodBarChart(series, isSingleDayHourly) {
  if (!series || series.length === 0) {
    return '<div class="empty">所选时间范围内暂无消耗记录</div>';
  }
  const W = getChartWidth(720);
  const H = 195;
  const padL = W < 480 ? 46 : 56;
  const padR = 14;
  const padT = 18;
  const padB = 30;
  const plotW = Math.max(120, W - padL - padR);
  const plotH = H - padT - padB;

  const valOf = (d) => {
    if (state.periodMetric === 'tokens') return d.totalTokens || 0;
    if (state.periodMetric === 'calls') return d.calls || 0;
    return d.costUsd || 0;
  };
  const fmtTick = (v) => {
    if (v === 0) return '0';
    if (state.periodMetric === 'tokens') return fmtCnTokens(v);
    if (state.periodMetric === 'calls') return String(Math.round(v));
    return fmtCost(v);
  };

  const rawMax = Math.max(0, ...series.map(valOf));
  const maxVal = computeNiceMax(rawMax, state.periodMetric === 'cost');

  const slotW = plotW / series.length;
  const barW = Math.max(5, Math.min(32, slotW * 0.58));

  const yTicks = [0, 0.5, 1].map((t) => {
    const val = maxVal * t;
    const y = padT + plotH - t * plotH;
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${escapeHtml(fmtTick(val))}</text>
    `;
  }).join('');

  // Pick compact label text on narrow side panes so X-axis ticks never collide
  const useCompactHourLabel = isSingleDayHourly && W < 720;
  const formatXLabel = (d) => {
    if (useCompactHourLabel && d.hour) return d.hour.slice(11); // "00:00"
    if (W < 460 && d.hour) return d.hour.slice(5, 13); // "11-27 11"
    return d.label;
  };
  const minLabelPx = useCompactHourLabel ? 52 : (W < 520 ? 58 : 82);
  const maxLabels = Math.max(3, Math.floor(plotW / minLabelPx));
  const labelStep = Math.max(1, Math.ceil(series.length / maxLabels));

  const labelIndices = [];
  for (let i = 0; i < series.length; i += labelStep) {
    labelIndices.push(i);
  }
  const lastIdx = series.length - 1;
  if (lastIdx > 0) {
    const prevIdx = labelIndices[labelIndices.length - 1];
    if ((lastIdx - prevIdx) * slotW >= minLabelPx * 0.72) {
      labelIndices.push(lastIdx);
    } else if (labelIndices.length > 1) {
      labelIndices[labelIndices.length - 1] = lastIdx;
    }
  }
  const labelSet = new Set(labelIndices);

  const bars = series.map((d, i) => {
    const v = valOf(d);
    const totalH = v > 0 ? Math.max(3, (v / maxVal) * plotH) : 0;
    const x = padL + i * slotW + (slotW - barW) / 2;
    const cx = padL + i * slotW + slotW / 2;
    const baseY = padT + plotH;
    const showLabel = labelSet.has(i);
    const anchor = i === 0 && cx - padL < 22 ? 'start' : (i === lastIdx && W - padR - cx < 22 ? 'end' : 'middle');
    const tx = anchor === 'start' ? padL : (anchor === 'end' ? W - padR : cx);

    let barSvg = '';
    if (totalH > 0 && state.periodMetric === 'tokens') {
      const tot = Math.max(1, d.totalTokens || 0);
      const cacheH = (d.cacheReadTokens / tot) * totalH;
      const inH = (d.inputTokens / tot) * totalH;
      const outH = Math.max(0, totalH - cacheH - inH);
      const clipId = `bar-clip-${i}`;
      barSvg = `
        <defs>
          <clipPath id="${clipId}">
            <rect x="${x.toFixed(1)}" y="${(baseY - totalH).toFixed(1)}" width="${barW.toFixed(1)}" height="${totalH.toFixed(1)}" rx="3.5" />
          </clipPath>
        </defs>
        <g clip-path="url(#${clipId})">
          <rect x="${x.toFixed(1)}" y="${(baseY - cacheH).toFixed(1)}" width="${barW.toFixed(1)}" height="${cacheH.toFixed(1)}" fill="#0891b2" />
          <rect x="${x.toFixed(1)}" y="${(baseY - cacheH - inH).toFixed(1)}" width="${barW.toFixed(1)}" height="${inH.toFixed(1)}" fill="#2563eb" />
          <rect x="${x.toFixed(1)}" y="${(baseY - totalH).toFixed(1)}" width="${barW.toFixed(1)}" height="${outH.toFixed(1)}" fill="#8b5cf6" />
        </g>
      `;
    } else if (totalH > 0) {
      const fill = state.periodMetric === 'cost' ? '#d97706' : '#0891b2';
      barSvg = `<rect x="${x.toFixed(1)}" y="${(baseY - totalH).toFixed(1)}" width="${barW.toFixed(1)}" height="${totalH.toFixed(1)}" rx="3.5" fill="${fill}" />`;
    }

    return `
      <g class="bar-slot" data-idx="${i}">
        ${barSvg}
        <rect x="${(padL + i * slotW).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${plotH}" fill="transparent" style="cursor:pointer" />
      </g>
      ${showLabel ? `<text x="${tx.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" font-size="11" fill="var(--text-muted)">${escapeHtml(formatXLabel(d))}</text>` : ''}
    `;
  }).join('');

  return `
    <div class="bar-chart-stage" id="barChartStage">
      <svg class="bar-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${yTicks}
        ${bars}
      </svg>
      <div class="chart-tooltip" id="barTooltip"></div>
    </div>
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
  const legendHtml = state.periodMetric === 'tokens'
    ? `
      <span class="trend-legend">
        <span class="legend-item"><span class="swatch" style="background:#0891b2"></span>缓存读取</span>
        <span class="legend-item"><span class="swatch" style="background:#2563eb"></span>新增输入</span>
        <span class="legend-item"><span class="swatch" style="background:#8b5cf6"></span>输出</span>
      </span>
    `
    : state.periodMetric === 'calls'
      ? '<span class="trend-legend"><span class="legend-item"><span class="swatch" style="background:#0891b2"></span>请求次数</span></span>'
      : '<span class="trend-legend"><span class="legend-item"><span class="swatch" style="background:#d97706"></span>参考成本</span></span>';

  const granToggleHtml = p.canHourly
    ? `
      <div class="segmented" title="切换时间粒度">
        <button class="gran-btn ${p.granularity === 'hour' ? 'active' : ''}" data-gran="hour">按时</button>
        <button class="gran-btn ${p.granularity === 'day' ? 'active' : ''}" data-gran="day">按天</button>
      </div>
    `
    : '';

  const modelChips = p.models.map((m) => `
    <span class="chip">
      <strong>${escapeHtml(m.label)}</strong>
      <span>${m.calls}次</span>
      <span>总 ${fmtCnTokens(m.totalTokens)}</span>
      <span class="cost-inline">${fmtCost(m.costUsd)}</span>
    </span>
  `).join('');

  const tableSource = p.granularity === 'hour'
    ? p.series.filter((x) => x.calls > 0)
    : p.matched;

  const tableRows = [...tableSource].reverse().map((d) => `
    <tr>
      <td><strong>${escapeHtml(d.key)}</strong></td>
      <td class="num">${d.calls}</td>
      <td class="num"><strong>${fmtNum(d.totalTokens)}</strong></td>
      <td class="num">${fmtNum(d.inputTokens)}</td>
      <td class="num">${fmtNum(d.cacheReadTokens)}</td>
      <td class="num">${fmtNum(d.outputTokens)}</td>
      <td class="num"><span class="cost-inline">${fmtCost(d.costUsd)}</span></td>
    </tr>
  `).join('');

  sec.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="trend-head-left">
          <h2>使用趋势 · ${escapeHtml(p.label)}</h2>
          ${legendHtml}
        </div>
        <div class="controls">
          ${granToggleHtml}
          <div class="segmented">
            <button class="metric-btn ${state.periodMetric === 'tokens' ? 'active' : ''}" data-metric="tokens">Tokens</button>
            <button class="metric-btn ${state.periodMetric === 'calls' ? 'active' : ''}" data-metric="calls">请求</button>
            <button class="metric-btn ${state.periodMetric === 'cost' ? 'active' : ''}" data-metric="cost">成本</button>
          </div>
          <button id="togglePeriodTableBtn" class="${state.periodTableOpen ? 'active' : ''}">明细表</button>
          <button id="copyPeriodMdBtn" title="复制 Markdown 统计报表">复制报表</button>
          <button id="exportPeriodCsvBtn" title="导出 Excel 兼容 CSV 明细">导出 CSV</button>
        </div>
      </div>
      <div class="chart-wrap">${renderPeriodBarChart(p.series, p.granularity === 'hour' && p.start === p.end)}</div>
      ${modelChips ? `<div class="chips chips-tight">${modelChips}</div>` : ''}
      ${state.periodTableOpen ? `
        <div class="period-table-wrap">
          <table>
            <thead>
              <tr>
                <th>${p.granularity === 'hour' ? '时段' : '日期'}</th>
                <th class="num">请求</th>
                <th class="num">总 Token</th>
                <th class="num">新增输入</th>
                <th class="num">缓存读取</th>
                <th class="num">输出</th>
                <th class="num">参考成本</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || '<tr><td colspan="7" class="empty">该时间段内暂无记录</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;

  // Bind instant floating tooltip on bar hover
  const stage = $('barChartStage');
  const tip = $('barTooltip');
  if (stage && tip) {
    stage.querySelectorAll('.bar-slot').forEach((slot) => {
      const idx = Number(slot.getAttribute('data-idx'));
      const item = p.series[idx];
      if (!item) return;
      slot.addEventListener('mouseenter', () => {
        tip.innerHTML = `
          <div class="tt-title">${escapeHtml(item.key)}</div>
          <div class="tt-row"><span>总 Token</span><strong>${fmtNum(item.totalTokens)} (${fmtCnTokens(item.totalTokens)})</strong></div>
          <div class="tt-row"><span style="color:#0891b2">● 缓存读取</span><span>${fmtNum(item.cacheReadTokens)}</span></div>
          <div class="tt-row"><span style="color:#2563eb">● 新增输入</span><span>${fmtNum(item.inputTokens)}</span></div>
          <div class="tt-row"><span style="color:#8b5cf6">● 输出</span><span>${fmtNum(item.outputTokens)}</span></div>
          <div class="tt-row"><span>请求次数</span><span>${fmtNum(item.calls)} 次</span></div>
          <div class="tt-row"><span>参考成本</span><strong class="cost-inline">${fmtCost(item.costUsd)}</strong></div>
        `;
        tip.style.display = 'block';
      });
      slot.addEventListener('mousemove', (e) => {
        const rect = stage.getBoundingClientRect();
        const tipW = tip.offsetWidth || 205;
        let left = e.clientX - rect.left + 12;
        if (left + tipW > rect.width - 8) left = Math.max(6, e.clientX - rect.left - tipW - 12);
        const top = Math.max(4, Math.min(rect.height - (tip.offsetHeight || 140) - 4, e.clientY - rect.top - 24));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      });
      slot.addEventListener('mouseleave', () => {
        tip.style.display = 'none';
      });
    });
  }

  sec.querySelectorAll('.metric-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.periodMetric = btn.getAttribute('data-metric') || 'tokens';
      renderPeriodSection();
    });
  });

  sec.querySelectorAll('.gran-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.granularity = btn.getAttribute('data-gran') || 'auto';
      renderPeriodSection();
    });
  });

  const tableToggle = $('togglePeriodTableBtn');
  if (tableToggle) {
    tableToggle.addEventListener('click', () => {
      state.periodTableOpen = !state.periodTableOpen;
      renderPeriodSection();
    });
  }

  const copyBtn = $('copyPeriodMdBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const colName = p.granularity === 'hour' ? '时段' : '日期';
      const mdLines = [
        `### Antigravity 使用统计（${p.label}）`,
        `- 总 Token（输入+缓存+输出）：${fmtNum(p.totalTokens)}（${fmtCnTokens(p.totalTokens)}）`,
        `- 新增输入 / 缓存读取 / 输出：${fmtNum(p.inputTokens)} / ${fmtNum(p.cacheReadTokens)} / ${fmtNum(p.outputTokens)}`,
        `- 请求次数：${fmtNum(p.calls)} 次（活跃会话 ${p.conversationCount} 个）`,
        `- 参考成本：${fmtCost(p.costUsd)}（缓存命中率 ${fmtPct(p.cacheHitRate)}）`,
        '',
        `| ${colName} | 请求 | 总 Token | 新增输入 | 缓存读取 | 输出 | 参考成本 |`,
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...[...tableSource].reverse().map((d) =>
          `| ${d.key} | ${d.calls} | ${fmtNum(d.totalTokens)} | ${fmtNum(d.inputTokens)} | ${fmtNum(d.cacheReadTokens)} | ${fmtNum(d.outputTokens)} | ${fmtCost(d.costUsd)} |`
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
        [p.granularity === 'hour' ? '时段' : '日期', '请求次数', '总Token', '新增输入Token', '缓存读取Token', '输出Token', `参考成本(${unit})`],
        ...[...tableSource].reverse().map((d) => [
          d.key,
          d.calls,
          d.totalTokens,
          d.inputTokens,
          d.cacheReadTokens,
          d.outputTokens,
          conv(d.costUsd || 0),
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
        state.stepPage = 1;
        renderConversationControls();
        fetchDetail(id);
      }
    });
  });
}

function isCtxChartOpen() {
  if (state.ctxChartOpen !== null) return state.ctxChartOpen;
  return (window.innerWidth || 0) >= 820;
}

function getWindowedSteps(steps) {
  if (!steps || steps.length === 0) return [];
  if (state.ctxWindow === '30') return steps.slice(-30);
  if (state.ctxWindow === '100') return steps.slice(-100);
  return steps;
}

function renderChart(rawSteps, limit) {
  const steps = getWindowedSteps(rawSteps);
  if (!steps || steps.length === 0) {
    return '<div class="empty">该会话还没有模型调用记录</div>';
  }
  const W = getChartWidth(720);
  const H = 190;
  const padL = W < 480 ? 48 : 56;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const plotW = Math.max(120, W - padL - padR);
  const plotH = H - padT - padB;

  const rawMax = Math.max(10000, ...steps.map((s) => s.contextTokens));
  const maxVal = computeNiceMax(rawMax, false);
  const xFor = (i) => (steps.length === 1 ? padL + plotW / 2 : padL + (i / (steps.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const ctxPoints = steps.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.contextTokens).toFixed(1)}`).join(' ');
  const cachePoints = steps.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.cacheReadTokens).toFixed(1)}`).join(' ');
  const areaPath =
    `M ${xFor(0).toFixed(1)},${(padT + plotH).toFixed(1)} ` +
    steps.map((s, i) => `L ${xFor(i).toFixed(1)},${yFor(s.contextTokens).toFixed(1)}`).join(' ') +
    ` L ${xFor(steps.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [0, 0.5, 1].map((t) => {
    const val = maxVal * t;
    const y = yFor(val);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${val === 0 ? '0' : fmtCnTokens(val)}</text>
    `;
  }).join('');

  // Highlight only compaction drop markers subtly, never cluttering normal steps with dense dots
  const compactionMarkers = steps
    .map((s, i) => {
      if (!s.isCompactionDrop) return '';
      const x = xFor(i).toFixed(1);
      const y = yFor(s.contextTokens).toFixed(1);
      return `
        <line x1="${x}" y1="${padT}" x2="${x}" y2="${(padT + plotH).toFixed(1)}" stroke="var(--accent-warn)" stroke-width="1" stroke-dasharray="3,3" opacity="0.65" />
        <circle cx="${x}" cy="${y}" r="3.5" fill="var(--accent-warn)" />
      `;
    })
    .join('');

  const maxXLabels = Math.max(3, Math.floor(plotW / 76));
  const xStep = Math.max(1, Math.ceil((steps.length - 1) / Math.max(1, maxXLabels - 1)));
  const xIndices = [];
  for (let i = 0; i < steps.length; i += xStep) xIndices.push(i);
  const lastI = steps.length - 1;
  if (lastI > 0 && xIndices[xIndices.length - 1] !== lastI) {
    if ((lastI - xIndices[xIndices.length - 1]) * (plotW / Math.max(1, lastI)) >= 52) {
      xIndices.push(lastI);
    } else if (xIndices.length > 1) {
      xIndices[xIndices.length - 1] = lastI;
    }
  }

  const xLabels = xIndices
    .map((i) => {
      const x = xFor(i);
      const anchor = i === 0 ? 'start' : (i === lastI ? 'end' : 'middle');
      const tx = i === 0 ? padL : (i === lastI ? W - padR : x);
      return `<text x="${tx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="var(--text-muted)">#${steps[i].stepIndex}</text>`;
    })
    .join('');

  return `
    <div class="chart-legend">
      <span class="legend-item"><span class="swatch" style="background:var(--accent-primary)"></span>总上下文</span>
      <span class="legend-item"><span class="swatch" style="background:#0891b2"></span>缓存读取</span>
      <span class="legend-item"><span class="swatch" style="background:var(--accent-warn)"></span>压缩回落</span>
      <span class="legend-right">显示 ${steps.length} / ${rawSteps.length} 步 · 上限 ${fmtCompact(limit)}</span>
    </div>
    <div class="bar-chart-stage" id="ctxChartStage"
      data-padl="${padL}" data-padr="${padR}" data-padt="${padT}" data-ploth="${plotH}"
      data-w="${W}" data-maxval="${maxVal}">
      <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        ${yTicks}
        <path d="${areaPath}" fill="var(--accent-primary-soft)" />
        <polyline fill="none" stroke="#0891b2" stroke-width="1.6" stroke-dasharray="4,3" points="${cachePoints}" />
        <polyline fill="none" stroke="var(--accent-primary)" stroke-width="2.2" stroke-linejoin="round" points="${ctxPoints}" />
        ${compactionMarkers}
        <line id="ctxCrosshair" x1="0" y1="${padT}" x2="0" y2="${(padT + plotH).toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3" style="display:none" />
        <circle id="ctxActiveDot" cx="0" cy="0" r="4.5" fill="var(--accent-primary)" stroke="var(--surface)" stroke-width="2" style="display:none" />
        <rect id="ctxHitArea" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair" />
        ${xLabels}
      </svg>
      <div class="chart-tooltip" id="ctxTooltip"></div>
    </div>
  `;
}

function bindCtxChartInteractions(rawSteps) {
  const stage = $('ctxChartStage');
  const hit = $('ctxHitArea');
  const crosshair = $('ctxCrosshair');
  const dot = $('ctxActiveDot');
  const tip = $('ctxTooltip');
  const steps = getWindowedSteps(rawSteps);
  if (!stage || !hit || !crosshair || !dot || !tip || steps.length === 0) return;

  const padL = Number(stage.getAttribute('data-padl'));
  const padR = Number(stage.getAttribute('data-padr'));
  const padT = Number(stage.getAttribute('data-padt'));
  const plotH = Number(stage.getAttribute('data-ploth'));
  const W = Number(stage.getAttribute('data-w'));
  const maxVal = Number(stage.getAttribute('data-maxval')) || 1;
  const plotW = Math.max(1, W - padL - padR);

  const showAt = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    const scaleX = W / Math.max(1, rect.width);
    const svgX = (clientX - rect.left) * scaleX;
    const ratio = Math.max(0, Math.min(1, (svgX - padL) / plotW));
    const idx = steps.length === 1 ? 0 : Math.round(ratio * (steps.length - 1));
    const s = steps[idx];
    if (!s) return;

    const cx = steps.length === 1 ? padL + plotW / 2 : padL + (idx / (steps.length - 1)) * plotW;
    const cy = padT + plotH - (s.contextTokens / maxVal) * plotH;

    crosshair.setAttribute('x1', cx.toFixed(1));
    crosshair.setAttribute('x2', cx.toFixed(1));
    crosshair.style.display = 'block';
    dot.setAttribute('cx', cx.toFixed(1));
    dot.setAttribute('cy', cy.toFixed(1));
    dot.style.display = 'block';

    const toolLabel = (s.tools && s.tools.length > 0) ? s.tools.slice(0, 3).join(', ') + (s.tools.length > 3 ? '…' : '') : '文本回复';
    tip.innerHTML = `
      <div class="tt-title">Step #${s.stepIndex} · ${fmtTime(s.createdAt)}${s.isCompactionDrop ? ' <span class="tag-compact">压缩</span>' : ''}</div>
      <div class="tt-row"><span>模型</span><span>${escapeHtml(s.modelLabel)}</span></div>
      <div class="tt-row"><span>总上下文</span><strong>${fmtNum(s.contextTokens)} (${fmtCnTokens(s.contextTokens)})</strong></div>
      <div class="tt-row"><span style="color:#0891b2">● 缓存读取</span><span>${fmtNum(s.cacheReadTokens)} (${fmtPct(s.cacheHitRate)})</span></div>
      <div class="tt-row"><span style="color:#2563eb">● 新增输入</span><span>${fmtNum(s.inputTokens)}</span></div>
      <div class="tt-row"><span style="color:#8b5cf6">● 输出</span><span>${fmtNum(s.outputTokens)}</span></div>
      <div class="tt-row"><span>参考成本</span><strong class="cost-inline">${fmtCost(s.costUsd)}</strong></div>
      <div class="tt-row"><span>动作</span><span>${escapeHtml(toolLabel)}</span></div>
    `;
    tip.style.display = 'block';

    const tipW = tip.offsetWidth || 210;
    let left = clientX - rect.left + 12;
    if (left + tipW > rect.width - 6) left = Math.max(6, clientX - rect.left - tipW - 12);
    const top = Math.max(4, Math.min(rect.height - (tip.offsetHeight || 150) - 4, clientY - rect.top - 24));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  hit.addEventListener('mousemove', (e) => showAt(e.clientX, e.clientY));
  hit.addEventListener('mouseenter', (e) => showAt(e.clientX, e.clientY));
  hit.addEventListener('mouseleave', () => {
    crosshair.style.display = 'none';
    dot.style.display = 'none';
    tip.style.display = 'none';
  });
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

  const allStepsRev = [...(d.steps || [])].reverse();
  const totalSteps = allStepsRev.length;
  const pageSize = state.stepPageSize > 0 ? state.stepPageSize : Math.max(1, totalSteps);
  const totalPages = Math.max(1, Math.ceil(totalSteps / pageSize));
  if (state.stepPage > totalPages) state.stepPage = totalPages;
  if (state.stepPage < 1) state.stepPage = 1;
  const startIdx = (state.stepPage - 1) * pageSize;
  const pageSteps = state.stepPageSize > 0
    ? allStepsRev.slice(startIdx, startIdx + pageSize)
    : allStepsRev;
  const rangeStart = totalSteps === 0 ? 0 : startIdx + 1;
  const rangeEnd = totalSteps === 0 ? 0 : Math.min(totalSteps, startIdx + pageSteps.length);

  const rowsHtml = pageSteps.map((s) => `
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
            <div class="k-label">本会话参考成本</div>
            <div class="k-val cost-val">${fmtCost(cost.totalUsd)}</div>
            <div class="k-sub">入 ${fmtCost(cost.inputUsd)} · 缓 ${fmtCost(cost.cacheUsd)} · 出 ${fmtCost(cost.outputUsd)}</div>
          </div>
          <div class="kpi-card">
            <div class="k-label">会话缓存命中率</div>
            <div class="k-val live-tag">${fmtPct(d.avgCacheHitRate)}</div>
            <div class="k-sub">缓存读取 ${fmtCnTokens(d.totals.cacheReadTokens)}</div>
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
            <div class="trend-head-left">
              <h2>上下文增长趋势</h2>
              <span class="muted small">共 ${(d.steps || []).length} 步 · 峰值 ${fmtCnTokens(d.peakContext)}${d.compactionCount > 0 ? ` · 压缩 ${d.compactionCount} 次` : ''}</span>
            </div>
            <div class="controls">
              ${isCtxChartOpen() ? `
                <div class="segmented">
                  <button class="ctx-win-btn ${state.ctxWindow === '30' ? 'active' : ''}" data-win="30">近 30 步</button>
                  <button class="ctx-win-btn ${state.ctxWindow === '100' ? 'active' : ''}" data-win="100">近 100 步</button>
                  <button class="ctx-win-btn ${state.ctxWindow === 'all' ? 'active' : ''}" data-win="all">全部</button>
                </div>
              ` : ''}
              <button id="toggleCtxChartBtn" class="${isCtxChartOpen() ? 'active' : ''}">${isCtxChartOpen() ? '收起' : '展开'}</button>
            </div>
          </div>
          ${isCtxChartOpen() ? `<div class="chart-wrap">${renderChart(d.steps, limit)}</div>` : ''}
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
      ${totalSteps > 0 ? `
        <div class="pagination-bar">
          <div class="pagination-controls">
            <span>第 ${rangeStart}–${rangeEnd} 条 / 共 ${totalSteps} 条</span>
            <select id="stepPageSizeSelect" title="每页显示条数">
              <option value="10" ${state.stepPageSize === 10 ? 'selected' : ''}>10 条/页</option>
              <option value="20" ${state.stepPageSize === 20 ? 'selected' : ''}>20 条/页</option>
              <option value="50" ${state.stepPageSize === 50 ? 'selected' : ''}>50 条/页</option>
              <option value="0" ${state.stepPageSize === 0 ? 'selected' : ''}>全部</option>
            </select>
          </div>
          <div class="pagination-controls">
            <button id="stepFirstBtn" ${state.stepPage <= 1 ? 'disabled' : ''}>首页</button>
            <button id="stepPrevBtn" ${state.stepPage <= 1 ? 'disabled' : ''}>上一页</button>
            <span>${state.stepPage} / ${totalPages}</span>
            <button id="stepNextBtn" ${state.stepPage >= totalPages ? 'disabled' : ''}>下一页</button>
            <button id="stepLastBtn" ${state.stepPage >= totalPages ? 'disabled' : ''}>末页</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const toggleCtxBtn = $('toggleCtxChartBtn');
  if (toggleCtxBtn) {
    toggleCtxBtn.addEventListener('click', () => {
      state.ctxChartOpen = !isCtxChartOpen();
      renderDetail();
    });
  }
  document.querySelectorAll('.ctx-win-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ctxWindow = btn.getAttribute('data-win') || '30';
      renderDetail();
    });
  });
  if (isCtxChartOpen()) {
    bindCtxChartInteractions(d.steps || []);
  }

  const pageSizeSel = $('stepPageSizeSelect');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', (e) => {
      state.stepPageSize = Number(e.target.value) || 0;
      state.stepPage = 1;
      renderDetail();
    });
  }
  const firstBtn = $('stepFirstBtn');
  const prevBtn = $('stepPrevBtn');
  const nextBtn = $('stepNextBtn');
  const lastBtn = $('stepLastBtn');
  if (firstBtn) firstBtn.addEventListener('click', () => { state.stepPage = 1; renderDetail(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { state.stepPage = Math.max(1, state.stepPage - 1); renderDetail(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { state.stepPage = Math.min(totalPages, state.stepPage + 1); renderDetail(); });
  if (lastBtn) lastBtn.addEventListener('click', () => { state.stepPage = totalPages; renderDetail(); });
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
      state.stepPage = 1;
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
      state.granularity = 'auto';
      state.periodOpen = true;
      renderRangeBar();
      renderSummary();
      renderPeriodSection();
    });
  });

  const onCustomDate = () => {
    state.customStart = $('startDateInput').value;
    state.customEnd = $('endDateInput').value;
    state.rangeMode = 'custom';
    state.granularity = 'auto';
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

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.overview) renderPeriodSection();
      if (state.detail) renderDetail();
    }, 120);
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
