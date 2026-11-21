import { test, expect } from '@playwright/test';
import path from 'node:path';

test('real PDF/TXT/Markdown, quantized semantic retrieval, persistence, isolation, and deletion', async ({
  page,
  browser,
}) => {
  const errors: string[] = [],
    apiRequests: string[] = [],
    externalRequests: string[] = [],
    contentRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.context().on('request', (r) => {
    if (new URL(r.url()).origin !== new URL(test.info().project.use.baseURL!).origin)
      externalRequests.push(r.url());
    if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(r.url());
    if (r.method() !== 'GET' || (r.postData() ?? '').includes('LOCAL_ONLY_7291'))
      contentRequests.push(r.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/browser-landing.png', fullPage: true });
  await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first notes' }).click();
  await page
    .getByLabel('Choose notes to upload')
    .setInputFiles([
      path.resolve('public/samples/dbms_notes.pdf'),
      path.resolve('public/samples/cloud_computing.txt'),
    ]);
  await page.getByRole('button', { name: 'Add 2 documents', exact: true }).click();
  await expect(page.getByText('Added to your notes', { exact: true })).toHaveCount(2, {
    timeout: 45000,
  });
  await page.getByLabel('Choose notes to upload').setInputFiles({
    name: 'biology.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Photosynthesis\nPlants use chlorophyll in chloroplasts to convert sunlight into chemical energy. Carbon dioxide and water produce glucose and oxygen.\nLOCAL_ONLY_7291\n<script>window.untrustedNote = true</script>',
    ),
  });
  await page.getByRole('button', { name: 'Add 1 document', exact: true }).click();
  await expect(page.getByText('Added to your notes', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await expect(page.getByRole('link', { name: 'Ask your notes' })).toBeVisible({ timeout: 150000 });
  await page.screenshot({ path: 'test-results/browser-dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'Ask your notes' }).click();
  async function search(question: string, filename: string, source?: string) {
    await page.getByLabel('What are you curious about?').fill(question);
    await page.getByRole('button', { name: 'Search notes', exact: true }).click();
    await expect(page.getByRole('heading', { name: question, exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.locator('.passage-card').first()).toContainText(filename);
    if (source) await expect(page.locator('.passage-card').first()).toContainText(source);
  }
  await search(
    'What design technique avoids duplicate information in tables?',
    'dbms_notes.pdf',
    'Page 1',
  );
  await page.locator('.passage-card').first().getByRole('button', { name: 'View source' }).click();
  await expect(page.getByRole('heading', { name: 'Page 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await search('Which normal form removes transitive dependencies?', 'dbms_notes.pdf', 'Page 2');
  await search(
    'Which cloud offering lets a customer rent virtual machines?',
    'cloud_computing.txt',
  );
  await search('How do plants turn sunlight into chemical energy?', 'biology.md', 'Text document');
  await page.locator('.passage-card').first().getByRole('button', { name: 'View source' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '<script>window.untrustedNote = true</script>',
  );
  expect(
    await page.evaluate(() => (window as Window & { untrustedNote?: boolean }).untrustedNote),
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: 'test-results/browser-search.png', fullPage: true });
  await page.reload();
  await expect(page.getByLabel('What are you curious about?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build search index' })).toHaveCount(0);
  await search('Why does normalization reduce repeated information?', 'dbms_notes.pdf');
  await page.context().setOffline(true);
  await search('Where is photosynthesis carried out?', 'biology.md');
  await page.context().setOffline(false);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('padhai-browser-v1');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise<{
      documents: unknown[];
      index: { passages: { vector: Float32Array }[] };
    }>((resolve) => {
      const r = db.transaction('workspace').objectStore('workspace').get('current');
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      documents: result.documents.length,
      dimensions: result.index.passages[0].vector.length,
    };
  });
  expect(stored).toEqual({ documents: 3, dimensions: 384 });
  const isolated = await browser.newContext();
  const isolatedPage = await isolated.newPage();
  await isolatedPage.goto('/notes');
  await expect(
    isolatedPage.getByRole('heading', { name: 'Your next idea belongs here.' }),
  ).toBeVisible();
  await isolated.close();
  const secondTab = await page.context().newPage();
  await secondTab.goto('/notes');
  await expect(secondTab.getByRole('button', { name: 'Preview biology.md' })).toBeVisible();
  await page.getByRole('link', { name: 'My Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete biology.md', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview biology.md' })).toHaveCount(0);
  await expect(secondTab.getByRole('button', { name: 'Preview biology.md' })).toHaveCount(0);
  await secondTab.close();
  await page.getByRole('link', { name: 'Ask PadhAI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build search index' })).toBeVisible();
  await page.getByRole('link', { name: 'Quiz Mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private AI access required.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create my quiz/ })).toBeDisabled();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('My local library');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  // A click starts an asynchronous IndexedDB transaction; reload after it commits.
  await expect(page.locator('.workspace-card strong')).toHaveText('My local library');
  await page.reload();
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('My local library');
  await page.getByRole('button', { name: 'Clear notes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all notes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('link', { name: 'My Notes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next idea belongs here.' })).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(contentRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('mobile layouts, real sample, duplicate and malformed uploads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'My Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Try sample notes' }).click();
  await page.getByRole('button', { name: /Cloud computing A text/ }).click();
  await expect(page.getByRole('button', { name: 'Preview cloud_computing.txt' })).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/browser-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Add notes', exact: true }).first().click();
  await page.getByLabel('Choose notes to upload').setInputFiles([
    { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') },
  ]);
  await page.getByRole('button', { name: 'Add 2 documents', exact: true }).click();
  await expect(
    page.getByText('This file is not a readable PDF. Export it as a PDF and retry.'),
  ).toBeVisible();
  await expect(page.getByText('This file is empty.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove broken.pdf from upload list' }).click();
  await page.getByRole('button', { name: 'Remove empty.txt from upload list' }).click();
  await page
    .getByLabel('Choose notes to upload')
    .setInputFiles(path.resolve('public/samples/cloud_computing.txt'));
  await page.getByRole('button', { name: 'Add 1 document', exact: true }).click();
  await expect(page.getByText('Already in your notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Preview cloud_computing.txt' }).click();
  await expect(page.getByRole('dialog')).toContainText('IaaS');
});

test('encrypted, textless, and oversized files leave existing notes intact', async ({ page }) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Try sample notes' }).click();
  await page.getByRole('button', { name: /Cloud computing A text/ }).click();
  await expect(page.getByRole('button', { name: 'Preview cloud_computing.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Add notes', exact: true }).first().click();
  await page
    .getByLabel('Choose notes to upload')
    .setInputFiles([
      path.resolve('e2e/fixtures/encrypted.pdf'),
      path.resolve('e2e/fixtures/no-text.pdf'),
    ]);
  await page.getByRole('button', { name: 'Add 2 documents', exact: true }).click();
  await expect(
    page.getByText('This PDF is password protected. Remove its password locally before importing.'),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByText(
      'No selectable text was found. Scanned PDFs need OCR first; image recognition is not included.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove encrypted.pdf from upload list' }).click();
  await page.getByRole('button', { name: 'Remove no-text.pdf from upload list' }).click();
  await page.getByLabel('Choose notes to upload').setInputFiles({
    name: 'too-large.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 'a'),
  });
  await page.getByRole('button', { name: 'Add 1 document', exact: true }).click();
  await expect(page.getByText('This file exceeds the 10 MiB limit.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Preview cloud_computing.txt' })).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(1);
});

test('a failed model download can be retried without losing notes', async ({ page }) => {
  await page.route('**/onnx/model_quantized.onnx', (route) =>
    route.fulfill({ status: 503, body: 'Temporarily unavailable' }),
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample notes' }).click();
  await page.getByRole('button', { name: /Cloud computing A text/ }).click();
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await expect(page.getByText(/The local search model could not load/)).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole('button', { name: 'Make notes searchable' })).toBeEnabled();
  await page.unroute('**/onnx/model_quantized.onnx');
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await expect(page.getByRole('link', { name: 'Ask your notes' })).toBeVisible({ timeout: 120000 });
  await page.getByRole('link', { name: 'Ask your notes' }).click();
  await page.getByLabel('What are you curious about?').fill('What is IaaS?');
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await expect(page.locator('.passage-card').first()).toContainText('cloud_computing.txt');
});

test('stopping a model download preserves notes and allows a fresh index', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/onnx/model_quantized.onnx', async (route) => {
    await gate;
    // Stopping indexing deliberately terminates the worker making this request.
    await route.continue().catch(() => {});
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Try sample notes' }).click();
  await page.getByRole('button', { name: /Cloud computing A text/ }).click();
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await page.getByRole('button', { name: 'Stop indexing' }).click();
  release();
  await page.unroute('**/onnx/model_quantized.onnx');
  await expect(page.getByRole('button', { name: 'Make notes searchable' })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview cloud_computing.txt' }).click();
  await expect(page.getByRole('dialog')).toContainText('IaaS');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await expect(page.getByRole('link', { name: 'Ask your notes' })).toBeVisible({ timeout: 120000 });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ask your notes' })).toBeVisible();
});
