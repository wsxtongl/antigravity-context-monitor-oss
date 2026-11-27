'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Built-in reference API rates (USD per 1M tokens)
const PRESET_RATES = [
  { match: 'gemini-4-argon', label: 'Gemini 4 Argon', input: 2.0, cacheRead: 0.1, output: 10.0 },
  { match: 'gemini-4-carbon', label: 'Gemini 4 Carbon', input: 2.0, cacheRead: 0.1, output: 10.0 },
  { match: 'gemini-4-neon', label: 'Gemini 4 Neon', input: 3.0, cacheRead: 0.15, output: 15.0 },
  { match: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', input: 1.5, cacheRead: 0.075, output: 7.5 },
  { match: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', input: 0.75, cacheRead: 0.075, output: 3.75 },
  { match: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', input: 2.0, cacheRead: 0.2, output: 12.0 },
  { match: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', input: 1.25, cacheRead: 0.125, output: 10.0 },
  { match: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', input: 0.1, cacheRead: 0.01, output: 0.4 },
  { match: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', input: 0.3, cacheRead: 0.03, output: 2.5 },
  { match: 'flash-lite', label: 'Flash Lite', input: 0.1, cacheRead: 0.01, output: 0.4 },
  { match: 'flash', label: 'Flash', input: 0.75, cacheRead: 0.075, output: 3.75 },
  { match: 'claude-opus', label: 'Claude Opus', input: 4.0, cacheRead: 0.2, output: 20.0 },
  { match: 'opus', label: 'Claude Opus', input: 4.0, cacheRead: 0.2, output: 20.0 },
  { match: 'claude-sonnet', label: 'Claude Sonnet', input: 2.0, cacheRead: 0.1, output: 10.0 },
  { match: 'sonnet', label: 'Claude Sonnet', input: 2.0, cacheRead: 0.1, output: 10.0 },
  { match: 'claude-haiku', label: 'Claude Haiku', input: 0.1, cacheRead: 0.01, output: 0.5 },
  { match: 'haiku', label: 'Claude Haiku', input: 0.1, cacheRead: 0.01, output: 0.5 },
  { match: 'gpt-4o-mini', label: 'GPT-4o mini', input: 0.15, cacheRead: 0.075, output: 0.6 },
  { match: 'gpt-4o', label: 'GPT-4o', input: 2.5, cacheRead: 1.25, output: 10.0 },
];

const DEFAULT_FALLBACK_RATE = {
  input: 2.0,
  cacheRead: 0.1,
  output: 10.0,
};

function resolveDataDir() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--data-dir=')) {
      const val = arg.slice('--data-dir='.length).trim();
      if (val) return val;
    }
  }
  if (process.env.CONTEXT_MONITOR_DATA_DIR) {
    return process.env.CONTEXT_MONITOR_DATA_DIR;
  }
  return path.join(os.homedir(), '.gemini', 'config', 'plugins', 'context-monitor', 'data');
}

const DATA_DIR = resolveDataDir();
const CONFIG_PATH = path.join(DATA_DIR, 'pricing.json');

let configVersion = 1;
let cachedConfig = null;

function defaultConfig() {
  return {
    currency: 'USD',
    cnyRate: 7.25,
    overrides: {},
  };
}

function sanitizeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sanitizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const currency = raw.currency === 'CNY' ? 'CNY' : 'USD';
  const cnyRate = sanitizeNumber(raw.cnyRate, base.cnyRate) || base.cnyRate;
  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [k, v] of Object.entries(raw.overrides)) {
      if (!k || !v || typeof v !== 'object') continue;
      overrides[String(k)] = {
        input: sanitizeNumber(v.input, DEFAULT_FALLBACK_RATE.input),
        cacheRead: sanitizeNumber(v.cacheRead, DEFAULT_FALLBACK_RATE.cacheRead),
        output: sanitizeNumber(v.output, DEFAULT_FALLBACK_RATE.output),
      };
    }
  }
  return { currency, cnyRate, overrides };
}

function loadPricingConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      cachedConfig = sanitizeConfig(parsed);
      return cachedConfig;
    }
  } catch {
    // Fallback to default on corrupt file
  }
  cachedConfig = defaultConfig();
  return cachedConfig;
}

function savePricingConfig(nextRaw) {
  const next = sanitizeConfig(nextRaw);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  cachedConfig = next;
  configVersion += 1;
  return next;
}

function getPricingVersion() {
  return configVersion;
}

function resolveModelRate(modelName) {
  const cfg = loadPricingConfig();
  const key = String(modelName || '').trim();
  if (key && cfg.overrides[key]) {
    return { ...cfg.overrides[key], source: 'custom' };
  }
  const lower = key.toLowerCase();
  if (lower) {
    for (const preset of PRESET_RATES) {
      if (lower.includes(preset.match)) {
        return {
          input: preset.input,
          cacheRead: preset.cacheRead,
          output: preset.output,
          source: 'preset',
        };
      }
    }
  }
  return { ...DEFAULT_FALLBACK_RATE, source: 'default' };
}

function calculateStepCost(modelName, inputTokens, cacheReadTokens, outputTokens) {
  const rate = resolveModelRate(modelName);
  const inputUsd = (Number(inputTokens || 0) / 1e6) * rate.input;
  const cacheUsd = (Number(cacheReadTokens || 0) / 1e6) * rate.cacheRead;
  const outputUsd = (Number(outputTokens || 0) / 1e6) * rate.output;
  const totalUsd = inputUsd + cacheUsd + outputUsd;
  const cacheSavedUsd = (Number(cacheReadTokens || 0) / 1e6) * Math.max(0, rate.input - rate.cacheRead);
  return {
    inputUsd,
    cacheUsd,
    outputUsd,
    totalUsd,
    cacheSavedUsd,
    rate,
  };
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  loadPricingConfig,
  savePricingConfig,
  getPricingVersion,
  resolveModelRate,
  calculateStepCost,
};
