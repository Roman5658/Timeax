import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const publicDir = fileURLToPath(new URL('../dist-hosted/', import.meta.url));

export async function buildSite() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const configFile = fileURLToPath(new URL('../vite.hosted.config.ts', import.meta.url));
  await build({ root, configFile });
  await copyFile(
    new URL('../dist-hosted/hosted.html', import.meta.url),
    new URL('../dist-hosted/index.html', import.meta.url),
  );
}
