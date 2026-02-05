/**
 * 应用 acp-ws 库的补丁
 * 运行: node patches/apply-acp-ws-patches.js
 *
 * 这些补丁修复了 acp-ws 库在 Node.js 环境中的兼容性问题：
 * 1. HTTP -> HTTPS (agentcp.js)
 * 2. ws:// -> wss:// for HTTPS servers (websocket.js)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesPath = path.join(__dirname, '..', 'node_modules', 'acp-ws', 'dist');

// Patch 1: agentcp.js - HTTP to HTTPS
const agentcpPath = path.join(nodeModulesPath, 'agentcp.js');
if (fs.existsSync(agentcpPath)) {
  let content = fs.readFileSync(agentcpPath, 'utf-8');
  const original = content;
  content = content.replace(/http:\/\/acp3\./g, 'https://acp3.');
  if (content !== original) {
    fs.writeFileSync(agentcpPath, content);
    console.log('[patch] agentcp.js: HTTP -> HTTPS');
  } else {
    console.log('[patch] agentcp.js: already patched or no changes needed');
  }
} else {
  console.error('[patch] agentcp.js not found');
}

// Patch 2: websocket.js - ws:// to wss:// for HTTPS
const websocketPath = path.join(nodeModulesPath, 'websocket.js');
if (fs.existsSync(websocketPath)) {
  let content = fs.readFileSync(websocketPath, 'utf-8');
  const original = content;
  content = content.replace(
    'replace("https://", "ws://")',
    'replace("https://", "wss://")'
  );
  if (content !== original) {
    fs.writeFileSync(websocketPath, content);
    console.log('[patch] websocket.js: ws:// -> wss:// for HTTPS');
  } else {
    console.log('[patch] websocket.js: already patched or no changes needed');
  }
} else {
  console.error('[patch] websocket.js not found');
}

console.log('[patch] Done!');
