import { fileURLToPath } from 'node:url';
import { requireTargetNode, verifyRuntimeManifest } from './lib/hosted-config.mjs';

requireTargetNode();
await verifyRuntimeManifest(fileURLToPath(new URL('./', import.meta.url)));
process.env.TIMEAX_BIND ??= process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1';
await import('./hosted-start.server.mjs');
