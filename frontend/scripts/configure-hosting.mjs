import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function hostingRules() {
  // The Function owns /api/ai; unmatched application routes use the SPA fallback.
  return '/*  /index.html  200\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeFileSync(new URL('../dist/_redirects', import.meta.url), hostingRules());
}
