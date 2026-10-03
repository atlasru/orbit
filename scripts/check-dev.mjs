import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(config.build.devUrl, 'http://127.0.0.1:1420');
assert.equal(config.build.beforeDevCommand, 'npm run dev');
assert.equal(config.build.frontendDist, '../dist');
const blocker = net.createServer();
await new Promise((resolve, reject) => blocker.once('error', reject).listen(1420, '127.0.0.1', resolve));
try {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; vite.stdout.on('data', x => { log += x; }); vite.stderr.on('data', x => { log += x; });
  const timeout = setTimeout(() => vite.kill(), 10000);
  const code = await new Promise(resolve => vite.once('exit', resolve));
  clearTimeout(timeout);
  assert.notEqual(code, 0, 'Vite must fail when the configured port is occupied');
  assert.match(log, /Port 1420 is already in use/);
} finally { blocker.close(); }
console.log('Dev URL/port alignment and strict port failure passed.');
