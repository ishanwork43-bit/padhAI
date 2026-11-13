import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export function appUrl(value = '') {
  if (!value.trim()) return '';
  if (/[\u0000-\u0020\u007f]/u.test(value) || value.length > 2048) {
    throw new Error('APP_URL must be a plain HTTPS Streamlit origin without whitespace.');
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('APP_URL is not a valid URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.search || url.hash || url.pathname !== '/' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.streamlit\.app$/u.test(url.hostname)) {
    throw new Error('APP_URL must be https://<your-app>.streamlit.app with no path, credentials, query, or fragment.');
  }
  return url.origin + '/';
}

export function render(template, value) {
  const url = appUrl(value);
  const cta = url
    ? `<a class="button primary" href="${url}" target="_blank" rel="noopener noreferrer">Open PadhAI <span aria-hidden="true">→</span></a>`
    : '<span class="button pending" role="status">Study app launching soon</span>';
  const status = url
    ? 'Opens the full study app in a new tab. Start with the sample notes below.'
    : 'The study app is being set up. Explore the workflow and try the sample notes below.';
  return template.replaceAll('{{APP_CTA}}', cta).replaceAll('{{APP_STATUS}}', status);
}

export async function build(value = process.env.APP_URL ?? '', output = join(root, 'dist')) {
  // Validate before touching any existing build. Only these named public files ship.
  const html = render(await readFile(join(root, 'index.html'), 'utf8'), value);
  const assets = ['styles.css', 'favicon.svg', '404.html'];
  const assetContents = await Promise.all(assets.map(name => readFile(join(root, name))));
  const samples = ['dbms_notes.pdf', 'dbms_notes.md', 'cloud_computing.txt'];
  const sampleContents = await Promise.all(samples.map(name => readFile(join(root, '../sample_data', name))));
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, 'samples'), { recursive: true });
  await writeFile(join(output, 'index.html'), html);
  await Promise.all(assets.map((name, i) => writeFile(join(output, name), assetContents[i])));
  await Promise.all(samples.map((name, i) => writeFile(join(output, 'samples', name), sampleContents[i])));
  return { output, linked: Boolean(appUrl(value)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await build();
    console.log(`Built ${result.output}. Study app: ${result.linked ? 'linked' : 'pending (launch is unavailable)'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
