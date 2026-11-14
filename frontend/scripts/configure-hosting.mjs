// Netlify-only build output. The backend origin is public configuration, never a credential.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function proxyRules(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Set PADHAI_API_ORIGIN to the deployed backend HTTPS origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    /\s/.test(value) ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost')
  ) {
    throw new Error(
      'PADHAI_API_ORIGIN must be an HTTPS origin without credentials, paths, queries, or fragments.',
    );
  }
  return `/api/*  ${url.origin}/api/:splat  200!\n/*  /index.html  200\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    writeFileSync(
      new URL('../dist/_redirects', import.meta.url),
      proxyRules(process.env.PADHAI_API_ORIGIN),
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
