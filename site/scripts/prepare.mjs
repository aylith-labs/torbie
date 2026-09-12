import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
await mkdir('static', { recursive: true });
await copyFile('../docs/favicon.svg', 'static/favicon.svg');
try { await cp('../docs/media', 'static/media', { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm('static/preview', { recursive: true, force: true });
await cp('preview/dist', 'static/preview', { recursive: true });
