import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('.generated', { recursive: true });
const initial = spawnSync('npm', ['run', 'tailwind:build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const watcher = spawn('npm', ['run', 'tailwind:watch'], { stdio: 'inherit', shell: process.platform === 'win32' });
const astro = spawn('npm', ['run', 'astro:dev'], { stdio: 'inherit', shell: process.platform === 'win32' });
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; watcher.kill('SIGTERM'); astro.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
astro.on('exit', code => { stop(); process.exit(code ?? 0); });
watcher.on('exit', code => { if (!stopping && code !== 0) { stop(); process.exit(code ?? 1); } });
