import { expect, test } from '@playwright/test';
import { createHandler } from '../../netlify/functions/server/handler.mjs';

test('anonymous browser proof, explicit consent and a mocked summary work without an invitation', async ({
  page,
  baseURL,
}) => {
  // Real Function logic and browser proof worker; storage and Groq are test-only fixtures.
  const values = new Map();
  let serial = 0,
    providerCalls = 0,
    sessions = 0;
  const store = {
    async getWithMetadata(key: string) {
      return structuredClone(values.get(key) ?? null);
    },
    async setJSON(
      key: string,
      data: unknown,
      options: { onlyIfNew?: boolean; onlyIfMatch?: string } = {},
    ) {
      const current = values.get(key);
      if (
        (options.onlyIfNew && current) ||
        (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)
      )
        return { modified: false };
      values.set(key, { data: structuredClone(data), etag: String(++serial) });
      return { modified: true };
    },
  };
  const handler = createHandler({
    env: {
      PADHAI_AI_ENABLED: 'true',
      GROQ_API_KEY: 'test-only-provider-key',
      PADHAI_AI_SESSION_SECRET: 's'.repeat(43),
    },
    store,
    fetcher: async (_url: string, options: RequestInit) => {
      providerCalls++;
      const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  status: 'supported',
                  claims: [
                    {
                      text: 'Chlorophyll helps plants absorb sunlight.',
                      citations: [
                        {
                          source_id: input.source_data[0].source_id,
                          quote: 'Plants use chlorophyll to absorb sunlight.',
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    },
  });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route('**/api/ai?*', async (route) => {
    const original = route.request(),
      url = new URL(original.url());
    if (url.searchParams.get('action') === 'session') sessions++;
    const headers = await original.allHeaders();
    if (headers.origin) headers.origin = 'https://study.example';
    const request = new Request(`https://study.example${url.pathname}${url.search}`, {
      method: original.method(),
      headers,
      ...(original.postData() ? { body: original.postData()! } : {}),
    });
    const response = await handler(request, { ip: '203.0.113.7' });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.goto('/settings');
  await expect(page.getByText('Groq AI ready', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Private access code', { exact: true })).toHaveCount(0);
  const consent = page.getByLabel('Allow selected excerpts to be sent to Groq');
  await expect(consent).not.toBeChecked();
  expect(providerCalls).toBe(0);
  await consent.check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Workspace preferences saved.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'My Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Add notes', exact: true }).first().click();
  await page.getByLabel('Choose notes to upload').setInputFiles({
    name: 'biology.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Plants use chlorophyll to absorb sunlight. Photosynthesis converts sunlight into chemical energy. Plants produce glucose and oxygen.',
    ),
  });
  await page.getByRole('button', { name: 'Add 1 document', exact: true }).click();
  await expect(page.getByText('Added to your notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('link', { name: 'AI Summary', exact: true }).click();
  await page.getByRole('checkbox', { name: /biology.txt/ }).check();
  await expect(page.getByRole('button', { name: 'Generate summary', exact: true })).toBeEnabled({
    timeout: 150000,
  });
  await page.getByRole('button', { name: 'Generate summary', exact: true }).click();
  await expect(page.locator('.summary-results .answer-claim')).toContainText(
    'Chlorophyll helps plants absorb sunlight.',
  );
  expect(providerCalls).toBe(1);
  await page.reload();
  await expect(page.locator('.summary-results .answer-claim')).toContainText(
    'Chlorophyll helps plants absorb sunlight.',
  );
  await expect(page.getByText('Groq AI ready', { exact: true })).toBeVisible();
  expect(sessions).toBe(1);
  await page.getByRole('link', { name: 'Quiz Mode', exact: true }).click();
  await expect(page.getByRole('option', { name: '20 questions · Coming soon' })).toBeDisabled();
  await expect(page.getByRole('option', { name: /5 questions/ })).toBeEnabled();
  await expect(page.getByRole('option', { name: /10 questions/ })).toBeEnabled();
  expect(providerCalls).toBe(1);
});
