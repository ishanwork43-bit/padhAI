import { test, expect } from '@playwright/test';
import path from 'node:path';

test('real upload, model indexing, retrieval, source preview, isolation, and deletion', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Less searching/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for understanding.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add your first notes' }).click();
  await page
    .getByLabel('Choose notes to upload')
    .setInputFiles([
      path.resolve('../sample_data/dbms_notes.pdf'),
      path.resolve('../sample_data/cloud_computing.txt'),
    ]);
  await page.getByRole('button', { name: 'Add 2 documents' }).click();
  await expect(page.getByText('Added to your notes', { exact: true })).toHaveCount(2, {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make notes searchable' })).toBeVisible();
  await page.getByRole('button', { name: 'Make notes searchable' }).click();
  await expect(page.getByRole('link', { name: 'Ask your notes' })).toBeVisible({ timeout: 120000 });
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Ask your notes' }).click();
  await page
    .getByLabel('What are you curious about?')
    .fill('How does database normalization reduce redundancy?');
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await expect(page.locator('.passage-card').first()).toContainText('dbms_notes.pdf');
  await expect(page.locator('.passage-card').first()).toContainText('Page 1');
  await page.locator('.passage-card').first().getByRole('button', { name: 'View source' }).click();
  await expect(page.getByRole('dialog')).toContainText('normalization', { ignoreCase: true });
  await expect(page.getByRole('heading', { name: 'Page 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: 'Page 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: 'test-results/search-desktop.png', fullPage: true });
  await page.getByLabel('What are you curious about?').fill('What is IaaS in cloud computing?');
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await expect(page.locator('.passage-card').first()).toContainText('cloud_computing.txt');
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto('/notes');
  await expect(other.getByRole('heading', { name: 'Your next idea belongs here.' })).toBeVisible();
  await isolated.close();
  await page.getByRole('link', { name: 'Quiz Mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI quizzes are currently off.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create my quiz' })).toBeDisabled();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('My focused study space');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.locator('.workspace-card strong')).toHaveText('My focused study space');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/settings-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Clear notes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all notes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'My Notes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next idea belongs here.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile navigation, honest empty states, and responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for understanding.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'My Notes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next idea belongs here.' })).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Try sample notes' }).click();
  await page.getByRole('button', { name: /Cloud computing A text/ }).click();
  await expect(page.getByRole('button', { name: 'Preview cloud_computing.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview cloud_computing.txt' }).click();
  await expect(page.getByRole('dialog')).toContainText('IaaS');
});
