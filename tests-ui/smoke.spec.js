import { test, expect } from '@playwright/test';

async function login(page, email) {
  await page.goto('/app/');
  await page.fill('#email', email);
  await page.fill('#password', 'test1234');
  await page.click('#login-btn');
  await expect(page.locator('.shell')).toBeVisible();
}

test('panel: comercio normal — todas las pestañas cargan sin error de consola', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'qa@test.local');
  for (const id of ['resumen', 'menu', 'pedidos', 'gastos', 'campanias', 'mensajes', 'ajustes']) {
    await page.locator(`.tab[data-nav="${id}"]`).click();
    await expect(page.locator('.view-head h1')).toBeVisible();
  }
  // un comercio normal NO debe ver la pestaña Admin
  await expect(page.locator('.tab[data-nav="admin"]')).toHaveCount(0);
  expect(errors, `errores de consola:\n${errors.join('\n')}`).toEqual([]);
});

test('panel: la cuenta root ve la pestaña Admin y abre el panel', async ({ page }) => {
  await login(page, 'root@test.local');
  const adminTab = page.locator('.tab[data-nav="admin"]');
  await expect(adminTab).toBeVisible({ timeout: 10000 }); // aparece tras detectRoot
  await adminTab.click();
  await expect(page.locator('.view-head h1')).toContainText('Administración');
});

test('storefront: la landing carga el menú', async ({ page }) => {
  await page.goto('/r/qa-demo');
  await expect(page.locator('.hero h1')).toBeVisible();
  await expect(page.locator('.prod').first()).toBeVisible();
});
