'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const esbuild = require('esbuild');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const MAX_HTML_BYTES = 10 * 1024 * 1024; // Antigravity MCP App resource limit (10 MiB)

function copyFileSafe(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function build() {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1. Bundle browser MCP App UI and inline into single self-contained HTML
  const uiResult = await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, 'src', 'app.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
  });

  const bundledJs = uiResult.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
  const template = fs.readFileSync(path.join(REPO_ROOT, 'src', 'template.html'), 'utf8');
  if (!template.includes('/*__APP_BUNDLE__*/')) {
    throw new Error('Missing /*__APP_BUNDLE__*/ placeholder in src/template.html');
  }

  // Always use function replacer so special patterns like $& inside bundled JS are never expanded
  const finalHtml = template.replace('/*__APP_BUNDLE__*/', () => bundledJs);

  const scriptMatch = finalHtml.match(/<script>([\s\S]*)<\/script>/);
  if (!scriptMatch || scriptMatch[1].includes('/*__APP_BUNDLE__*/')) {
    throw new Error('Failed to inline JS bundle cleanly into dist/app.html');
  }
  // Syntax gate: verify the final inlined script parses cleanly
  new Function(scriptMatch[1]);

  const htmlOut = path.join(DIST_DIR, 'app.html');
  fs.writeFileSync(htmlOut, finalHtml, 'utf8');
  const htmlSize = fs.statSync(htmlOut).size;
  if (htmlSize === 0 || htmlSize >= MAX_HTML_BYTES) {
    throw new Error(`dist/app.html size out of bounds: ${htmlSize} bytes`);
  }

  // 2. Bundle Node MCP server into single self-contained CJS file
  const serverOut = path.join(DIST_DIR, 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, 'src', 'server.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node18'],
    outfile: serverOut,
  });

  const serverSize = fs.statSync(serverOut).size;
  console.log('[build] OK');
  console.log(`  dist/app.html   : ${(htmlSize / 1024).toFixed(1)} KB (${htmlSize} bytes)`);
  console.log(`  dist/server.cjs : ${(serverSize / 1024).toFixed(1)} KB (${serverSize} bytes)`);

  // Optional: --install copies runtime bundle into local Antigravity plugins dir
  if (process.argv.includes('--install')) {
    const targetDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'context-monitor');
    const filesToCopy = [
      'plugin.json',
      'mcp_config.json',
      'README.md',
      path.join('assets', 'logo.svg'),
      path.join('dist', 'app.html'),
      path.join('dist', 'server.cjs'),
    ];
    for (const rel of filesToCopy) {
      const src = path.join(REPO_ROOT, rel);
      if (fs.existsSync(src)) {
        copyFileSafe(src, path.join(targetDir, rel));
      }
    }
    console.log(`[install] Synced plugin to: ${targetDir}`);
  }
}

build().catch((err) => {
  console.error('[build] FAILED:', err);
  process.exit(1);
});
