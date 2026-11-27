'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  calculateStepCost,
  getPricingVersion,
  resolveModelRate,
} = require('./pricing');

const BRAIN_DIR = process.env.ANTIGRAVITY_BRAIN_DIR
  || path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

function inferContextLimit(modelName) {
  const m = String(modelName || '').toLowerCase();
  if (!m) return 1000000;
  if (m.includes('claude')) return 200000;
  if (m.includes('gpt-4') || m.includes('o1') || m.includes('o3')) return 200000;
  if (m.includes('gemini')) return 1000000;
  return 1000000;
}

function formatModelLabel(modelName) {
  if (!modelName) return '未知模型';
  return String(modelName)
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function toLocalDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalHourKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day} ${hr}:00`;
}

function extractUserText(content) {
  if (!content) return '';
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content.map((item) => (typeof item === 'string' ? item : item?.text || '')).join('\n');
  } else if (typeof content === 'object') {
    raw = content.text || JSON.stringify(content);
  }
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return (match ? match[1] : raw).replace(/\s+/g, ' ').trim();
}

function extractToolNames(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  const names = [];
  for (const tc of toolCalls) {
    if (!tc) continue;
    const name = tc.name || tc.function?.name || tc.tool_name || tc.tool;
    if (name) names.push(String(name));
  }
  return names;
}

const parseCache = new Map();

function parseTranscriptFile(convId, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const pVer = getPricingVersion();
  const cached = parseCache.get(convId);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.pVer === pVer) {
    return {
      ...cached.data,
      isActive: Date.now() - stat.mtimeMs < 5 * 60 * 1000,
    };
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = text.split(/\r?\n/);
  let title = '';
  let userTurns = 0;
  let totalInput = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  let costInputUsd = 0;
  let costCacheUsd = 0;
  let costOutputUsd = 0;
  let costTotalUsd = 0;
  let cacheSavedUsd = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let currentModel = '';
  let peakContext = 0;
  let compactionCount = 0;
  let prevContext = 0;

  const steps = [];
  const modelMap = new Map();
  const toolCounts = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.created_at) {
      if (!firstTimestamp) firstTimestamp = obj.created_at;
      lastTimestamp = obj.created_at;
    }

    if (obj.type === 'USER_INPUT') {
      userTurns += 1;
      if (!title) {
        const extracted = extractUserText(obj.content);
        if (extracted) title = extracted.slice(0, 80);
      }
    }

    const hasTokens =
      typeof obj.input_tokens === 'number' ||
      typeof obj.cache_read_tokens === 'number' ||
      typeof obj.output_tokens === 'number';

    if (hasTokens) {
      const inTok = Number(obj.input_tokens) || 0;
      const cacheTok = Number(obj.cache_read_tokens) || 0;
      const outTok = Number(obj.output_tokens) || 0;
      const contextTok = inTok + cacheTok;
      const cacheHitRate = contextTok > 0 ? cacheTok / contextTok : 0;
      const model = obj.model || currentModel || 'unknown';
      const tools = extractToolNames(obj.tool_calls);

      if (model && model !== 'unknown') currentModel = model;

      const isCompactionDrop = prevContext > 15000 && contextTok < prevContext * 0.7;
      if (isCompactionDrop) compactionCount += 1;
      prevContext = contextTok;

      if (contextTok > peakContext) peakContext = contextTok;

      const stepCost = calculateStepCost(model, inTok, cacheTok, outTok);

      totalInput += inTok;
      totalCacheRead += cacheTok;
      totalOutput += outTok;
      costInputUsd += stepCost.inputUsd;
      costCacheUsd += stepCost.cacheUsd;
      costOutputUsd += stepCost.outputUsd;
      costTotalUsd += stepCost.totalUsd;
      cacheSavedUsd += stepCost.cacheSavedUsd;

      for (const t of tools) {
        toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
      }

      const mStat = modelMap.get(model) || {
        model,
        label: formatModelLabel(model),
        calls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        maxContext: 0,
        costTotalUsd: 0,
        cacheSavedUsd: 0,
        rate: resolveModelRate(model),
      };
      mStat.calls += 1;
      mStat.inputTokens += inTok;
      mStat.cacheReadTokens += cacheTok;
      mStat.outputTokens += outTok;
      mStat.costTotalUsd += stepCost.totalUsd;
      mStat.cacheSavedUsd += stepCost.cacheSavedUsd;
      if (contextTok > mStat.maxContext) mStat.maxContext = contextTok;
      modelMap.set(model, mStat);

      steps.push({
        stepIndex: obj.step_index ?? i,
        createdAt: obj.created_at || null,
        type: obj.type || 'PLANNER_RESPONSE',
        model,
        modelLabel: formatModelLabel(model),
        inputTokens: inTok,
        cacheReadTokens: cacheTok,
        outputTokens: outTok,
        contextTokens: contextTok,
        cacheHitRate,
        costUsd: stepCost.totalUsd,
        cacheSavedUsd: stepCost.cacheSavedUsd,
        tools,
        isCompactionDrop,
      });
    }
  }

  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const currentContext = lastStep ? lastStep.contextTokens : 0;
  const currentCacheHitRate = lastStep ? lastStep.cacheHitRate : 0;
  const cumulativePromptTokens = totalInput + totalCacheRead;
  const avgCacheHitRate = cumulativePromptTokens > 0 ? totalCacheRead / cumulativePromptTokens : 0;

  const data = {
    id: convId,
    title: title || `会话 ${convId.slice(0, 8)}`,
    fileSizeBytes: stat.size,
    updatedAtMs: stat.mtimeMs,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    firstTimestamp,
    lastTimestamp,
    isActive: Date.now() - stat.mtimeMs < 5 * 60 * 1000,
    userTurns,
    modelCalls: steps.length,
    currentModel: currentModel || '',
    currentModelLabel: formatModelLabel(currentModel),
    defaultContextLimit: inferContextLimit(currentModel),
    currentContext,
    peakContext,
    currentCacheHitRate,
    avgCacheHitRate,
    compactionCount,
    totals: {
      inputTokens: totalInput,
      cacheReadTokens: totalCacheRead,
      outputTokens: totalOutput,
      totalNonCachedTokens: totalInput + totalOutput,
      totalProcessedTokens: totalInput + totalCacheRead + totalOutput,
    },
    cost: {
      inputUsd: costInputUsd,
      cacheUsd: costCacheUsd,
      outputUsd: costOutputUsd,
      totalUsd: costTotalUsd,
      cacheSavedUsd,
    },
    models: Array.from(modelMap.values()).sort((a, b) => b.calls - a.calls),
    topTools: Array.from(toolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    steps,
  };

  parseCache.set(convId, { mtimeMs: stat.mtimeMs, size: stat.size, pVer, data });
  return data;
}

function emptySummary() {
  return {
    conversationCount: 0,
    activeCount: 0,
    totalModelCalls: 0,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
    totalProcessedTokens: 0,
    todayInputTokens: 0,
    todayCacheReadTokens: 0,
    todayOutputTokens: 0,
    todayCalls: 0,
    avgCacheHitRate: 0,
    todayCostUsd: 0,
    todayCacheSavedUsd: 0,
    totalCostUsd: 0,
    totalCacheSavedUsd: 0,
  };
}

function scanAllConversations() {
  if (!fs.existsSync(BRAIN_DIR)) {
    return {
      brainDir: BRAIN_DIR,
      exists: false,
      generatedAt: new Date().toISOString(),
      summary: emptySummary(),
      knownModels: [],
      dailyStats: [],
      hourlyStats: [],
      conversations: [],
    };
  }

  let entries;
  try {
    entries = fs.readdirSync(BRAIN_DIR, { withFileTypes: true });
  } catch {
    return {
      brainDir: BRAIN_DIR,
      exists: false,
      generatedAt: new Date().toISOString(),
      summary: emptySummary(),
      knownModels: [],
      dailyStats: [],
      hourlyStats: [],
      conversations: [],
    };
  }

  const conversations = [];
  const activeIds = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const convId = entry.name;
    if (convId.includes('..') || convId.includes('/') || convId.includes('\\')) continue;
    const tPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(tPath)) continue;
    activeIds.add(convId);
    const parsed = parseTranscriptFile(convId, tPath);
    if (parsed) conversations.push(parsed);
  }

  for (const key of parseCache.keys()) {
    if (!activeIds.has(key)) parseCache.delete(key);
  }

  conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  const summary = emptySummary();
  summary.conversationCount = conversations.length;
  summary.activeCount = conversations.filter((c) => c.isActive).length;

  const now = new Date();
  const todayKey = toLocalDateKey(now.toISOString());
  const currentHour = now.getHours();
  const knownModelMap = new Map();
  const dailyMap = new Map();
  const hourlyMap = new Map();

  for (const c of conversations) {
    summary.totalModelCalls += c.modelCalls;
    summary.totalInputTokens += c.totals.inputTokens;
    summary.totalCacheReadTokens += c.totals.cacheReadTokens;
    summary.totalOutputTokens += c.totals.outputTokens;
    summary.totalProcessedTokens += c.totals.totalProcessedTokens;
    summary.totalCostUsd += c.cost.totalUsd;
    summary.totalCacheSavedUsd += c.cost.cacheSavedUsd;

    for (const m of c.models) {
      if (!knownModelMap.has(m.model)) {
        knownModelMap.set(m.model, {
          model: m.model,
          label: m.label,
          rate: resolveModelRate(m.model),
        });
      }
    }

    for (const s of c.steps) {
      const dateKey = toLocalDateKey(s.createdAt) || toLocalDateKey(c.updatedAt) || todayKey;
      const hourKey = toLocalHourKey(s.createdAt) || toLocalHourKey(c.updatedAt) || `${todayKey} 00:00`;
      const stepTotalTok = s.inputTokens + s.cacheReadTokens + s.outputTokens;

      let bucket = dailyMap.get(dateKey);
      if (!bucket) {
        bucket = {
          date: dateKey,
          calls: 0,
          convIds: new Set(),
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          cacheSavedUsd: 0,
          byModel: {},
        };
        dailyMap.set(dateKey, bucket);
      }

      bucket.calls += 1;
      bucket.convIds.add(c.id);
      bucket.inputTokens += s.inputTokens;
      bucket.cacheReadTokens += s.cacheReadTokens;
      bucket.outputTokens += s.outputTokens;
      bucket.totalTokens += stepTotalTok;
      bucket.costUsd += s.costUsd || 0;
      bucket.cacheSavedUsd += s.cacheSavedUsd || 0;

      let hBucket = hourlyMap.get(hourKey);
      if (!hBucket) {
        hBucket = {
          hour: hourKey,
          date: dateKey,
          calls: 0,
          convIds: new Set(),
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          cacheSavedUsd: 0,
        };
        hourlyMap.set(hourKey, hBucket);
      }
      hBucket.calls += 1;
      hBucket.convIds.add(c.id);
      hBucket.inputTokens += s.inputTokens;
      hBucket.cacheReadTokens += s.cacheReadTokens;
      hBucket.outputTokens += s.outputTokens;
      hBucket.totalTokens += stepTotalTok;
      hBucket.costUsd += s.costUsd || 0;
      hBucket.cacheSavedUsd += s.cacheSavedUsd || 0;

      const mKey = s.model || 'unknown';
      if (!bucket.byModel[mKey]) {
        bucket.byModel[mKey] = {
          model: mKey,
          label: s.modelLabel || formatModelLabel(mKey),
          calls: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          cacheSavedUsd: 0,
        };
      }
      const bm = bucket.byModel[mKey];
      bm.calls += 1;
      bm.inputTokens += s.inputTokens;
      bm.cacheReadTokens += s.cacheReadTokens;
      bm.outputTokens += s.outputTokens;
      bm.totalTokens += stepTotalTok;
      bm.costUsd += s.costUsd || 0;
      bm.cacheSavedUsd += s.cacheSavedUsd || 0;

      if (dateKey === todayKey) {
        summary.todayCalls += 1;
        summary.todayInputTokens += s.inputTokens;
        summary.todayCacheReadTokens += s.cacheReadTokens;
        summary.todayOutputTokens += s.outputTokens;
        summary.todayCostUsd += s.costUsd || 0;
        summary.todayCacheSavedUsd += s.cacheSavedUsd || 0;
      }
    }
  }

  const allPrompt = summary.totalInputTokens + summary.totalCacheReadTokens;
  summary.avgCacheHitRate = allPrompt > 0 ? summary.totalCacheReadTokens / allPrompt : 0;

  const dailyStats = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ convIds, byModel, ...rest }) => ({
      ...rest,
      conversationCount: convIds.size,
      conversationIds: Array.from(convIds),
      models: Object.values(byModel).sort((a, b) => b.costUsd - a.costUsd),
    }));

  const hourlyStats = Array.from(hourlyMap.values())
    .sort((a, b) => a.hour.localeCompare(b.hour))
    .map(({ convIds, ...rest }) => ({
      ...rest,
      conversationCount: convIds.size,
    }));

  return {
    brainDir: BRAIN_DIR,
    exists: true,
    generatedAt: new Date().toISOString(),
    todayKey,
    currentHour,
    summary,
    knownModels: Array.from(knownModelMap.values()),
    dailyStats,
    hourlyStats,
    conversations: conversations.map(({ steps, ...rest }) => rest),
  };
}

function getConversationDetail(convId, maxSteps = 200) {
  if (!convId || !/^[a-zA-Z0-9._-]+$/.test(convId)) return null;
  const tPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(tPath)) return null;
  const full = parseTranscriptFile(convId, tPath);
  if (!full) return null;
  if (full.steps.length > maxSteps) {
    return {
      ...full,
      truncatedSteps: full.steps.length - maxSteps,
      steps: full.steps.slice(-maxSteps),
    };
  }
  return full;
}

module.exports = {
  BRAIN_DIR,
  scanAllConversations,
  getConversationDetail,
};
