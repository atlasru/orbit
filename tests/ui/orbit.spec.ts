import { test, expect } from '@playwright/test';
import { desktop } from './mock';

test('browser alone clearly rejects desktop use', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Orbit is a desktop application.')).toBeVisible();
  await expect(page.locator('.radial-node')).toHaveCount(0);
});
test('mouse selects and executes a real action ID through typed IPC', async ({ page }) => {
  await desktop(page); await page.goto('/');
  await page.getByRole('option', { name: 'application' }).click();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls.some((x: any) => x.command === 'execute_node' && x.args.nodeId === 'n0' && x.args.profileId === 'default')).toBeTruthy();
});
test('keyboard enters submenu, returns, and Escape hides launcher', async ({ page }) => {
  await desktop(page); await page.goto('/');
  await page.getByRole('option', { name: 'submenu' }).hover();
  await page.keyboard.press('Enter'); await expect(page.locator('.radial-title')).toHaveText('submenu');
  await expect(page.getByRole('option', { name: 'system' })).toBeVisible();
  await page.keyboard.press('Backspace'); await expect(page.locator('.radial-title')).toHaveText('Default');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__calls.some((x: any) => x.command === 'hide_launcher'))).toBeTruthy();
});
test('preview permits navigation and suppresses executable actions', async ({ page }) => {
  await desktop(page); await page.goto('/'); await expect(page.locator('.radial-node')).toHaveCount(6);
  await page.evaluate(() => {
    const w = window as any;
    w.__emit('launcher-opened', { profile: w.__snapshot.profiles[0], settings: w.__snapshot.settings, preview: true, epoch: 2 });
  });
  await page.getByRole('option', { name: 'application' }).click();
  await expect(page.locator('.radial-notice')).toHaveText('Preview — actions disabled');
  expect(await page.evaluate(() => (window as any).__calls.some((x: any) => x.command === 'execute_node'))).toBeFalsy();
});
test('editor modifies action arguments, undo/redo, and saves', async ({ page }) => {
  await desktop(page); await page.goto('/?editor');
  await page.locator('[data-tree="n0"]').click();
  await page.getByLabel('Label', { exact: true }).fill('My application');
  await page.getByLabel('Arguments (JSON array)').fill('["one argument", "& literal"]');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('[data-tree="n0"] .tree-label')).toHaveText('My application');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-tree="n0"] .tree-label')).toHaveText('application');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-dirty]')).toHaveText('Saved');
  const n = await page.evaluate(() => (window as any).__snapshot.profiles[0].nodes[0]);
  expect(n.action.args).toEqual(['one argument', '& literal']);
});
test('node duplication and deletion update tree and can be undone', async ({ page }) => {
  await desktop(page); await page.goto('/?editor'); await page.locator('[data-tree="n5"]').click();
  await page.getByRole('button', { name: 'Duplicate node' }).click(); await expect(page.locator('[data-tree]')).toHaveCount(9);
  await page.getByRole('button', { name: 'Delete node' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click(); await expect(page.locator('[data-tree]')).toHaveCount(7);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('[data-tree]')).toHaveCount(9);
});
test('submenu type cannot change while it has children', async ({ page }) => {
  await desktop(page); await page.goto('/?editor'); await page.locator('[data-tree="n5"]').click();
  await page.getByLabel('Type', { exact: true }).selectOption('application');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('.editor-message')).toContainText('children before changing its type');
});
test('profile create, duplicate and activate work without restart', async ({ page }) => {
  await desktop(page); await page.goto('/?editor'); await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Work'); await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.profile-row')).toHaveCount(2);
  await page.locator('[data-profile="duplicate"]').click(); await page.getByRole('dialog').getByLabel('Name').fill('Gaming');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.profile-row')).toHaveCount(3);
  await page.locator('[data-activate]').click(); await expect(page.locator('[data-activate]')).toHaveText('Active');
});
test('import and preview never execute commands, including escaped labels', async ({ page }) => {
  await desktop(page); await page.goto('/?editor'); await page.locator('[data-import]').click();
  await expect(page.locator('.imported-warning')).toBeVisible(); await expect(page.locator('.editor-header h1')).toHaveText('<Imported>');
  await page.locator('[data-preview]').click();
  expect(await page.evaluate(() => (window as any).__calls.some((x: any) => x.command === 'execute_node'))).toBeFalsy();
});
test('settings text is captured before Save and theme choices persist', async ({ page }) => {
  await desktop(page); await page.goto('/?editor'); await page.locator('[data-tab="settings"]').click();
  await page.getByLabel('Global shortcut').fill('Ctrl+Alt+O');
  await page.getByLabel('Reduced Motion', { exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('[data-dirty]')).toHaveText('Saved');
  expect(await page.evaluate(() => (window as any).__snapshot.settings.shortcut)).toBe('Ctrl+Alt+O');
  expect(await page.evaluate(() => (window as any).__snapshot.settings.reducedMotion)).toBe(true);
});
