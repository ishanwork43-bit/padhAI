// Public model files only. Never download or embed user notes or credentials.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const model = JSON.parse(await readFile(new URL('./browser-model.json', import.meta.url), 'utf8'));
for (const [name, expected] of Object.entries(model.files)) {
  const target = new URL(`public/models/${model.directory}/${name}`, root);
  let bytes = await readFile(target).catch(() => null);
  const valid = (data) =>
    data?.length === expected.bytes &&
    createHash('sha256').update(data).digest('hex') === expected.sha256;
  if (!valid(bytes)) {
    const url = `https://huggingface.co/${model.repository}/resolve/${model.revision}/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok)
      throw new Error(`Public search model download failed (${response.status}): ${name}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes))
      throw new Error(`Public search model failed integrity verification: ${name}`);
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, bytes);
  }
}
const wasm = new URL('public/wasm/ort-1.22.0/', root);
await mkdir(wasm, { recursive: true });
for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await cp(new URL(`node_modules/onnxruntime-web/dist/${name}`, root), new URL(name, wasm));
}
for (const name of ['cmaps', 'standard_fonts']) {
  await cp(
    new URL(`node_modules/pdfjs-dist/${name}/`, root),
    new URL(`public/pdfjs/${name}/`, root),
    { recursive: true },
  );
}
console.log('Browser assets ready: pinned quantized MiniLM, local WASM, and PDF resources.');
