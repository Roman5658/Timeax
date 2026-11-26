import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { requireTargetNode, verifyRuntimeManifest } from './lib/hosted-config.mjs';
import { INTEGRATED_PROFILE } from './lib/integrated.contract.mjs';

requireTargetNode();
const server = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.resolve(server, 'public');
if (path.relative(server, publicDir) !== 'public') throw new Error('Unexpected output directory');
const generated = path.join(publicDir, '.timeax-generated');
try {
  const old = await lstat(publicDir);
  if (!old.isDirectory() || old.isSymbolicLink()) throw new Error('Unexpected output directory');
  await access(generated).catch(() => { throw new Error('Existing server/public is not managed by Timeax'); });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await build({
  root, configFile: path.join(root, 'vite.hosted.config.ts'),
  build: { outDir: publicDir, emptyOutDir: true },
});
await writeFile(generated, 'Generated from the canonical Timeax project.\n');
await rename(path.join(publicDir, 'hosted.html'), path.join(publicDir, 'index.html'));

const files = [];
async function add(relativePath) {
  const full = path.join(server, relativePath);
  const stat = await lstat(full);
  if (stat.isSymbolicLink()) throw new Error('Links are not allowed in a release');
  if (stat.isDirectory()) {
    for (const entry of (await readdir(full)).sort()) {
      if (entry.startsWith('.')) continue;
      const subpath = relativePath + '/' + entry;
      if (relativePath === 'lib' || relativePath === 'wire') {
        if (!entry.endsWith('.mjs')) throw new Error('Unexpected server source file: ' + entry);
      } else if (!/^[a-zA-Z0-9_.-]+$/.test(entry)) {
        throw new Error('Unexpected static release path');
      }
      await add(subpath);
    }
  } else if (stat.isFile()) {
    files.push({ path: relativePath, sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
  } else throw new Error('Unexpected release input');
}
for (const item of ['hosted-start.server.mjs','lib','package-lock.json','package.json','production-start.mjs','public','wire']) {
  await add(item);
}
await writeFile(path.join(server, 'runtime-manifest.json'), JSON.stringify({
  profile: INTEGRATED_PROFILE, builtWith: process.versions.node, files,
}, null, 2) + '\n');
const reviewed = await verifyRuntimeManifest(server);
console.log(JSON.stringify({ files: files.length, profile: reviewed.profile, sha256: reviewed.sha256 }));
