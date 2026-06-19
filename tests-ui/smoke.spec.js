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
  // el topbar muestra el email de la cuenta activa
  await expect(page.locator('.user-email')).toHaveText('qa@test.local', { timeout: 10000 });
  for (const id of ['resumen', 'menu', 'pedidos', 'gastos', 'campanias', 'mensajes', 'ajustes']) {
    await page.locator(`.tab[data-nav="${id}"]`).click();
    await expect(page.locator('.view-head h1')).toBeVisible();
  }
  // Gastos: solapas + vista tabla deben renderizar (cubre "Por evento" y la tabla tipo Excel)
  await page.locator('.tab[data-nav="gastos"]').click();
  await page.locator('.seg-btn[data-gt="eventos"]').click();
  await expect(page.locator('#new-ev')).toBeVisible();
  await page.locator('.seg-btn[data-gt="generales"]').click();
  await page.locator('.seg-btn[data-view="table"]').click();
  await expect(page.locator('.xls')).toBeVisible();
  // planilla editable: cargar una fila nueva en lote (ejercita /expenses/bulk)
  await page.fill('.xls-new [data-f="product"]', 'Aceite QA');
  await page.fill('.xls-new [data-f="total"]', '1200');
  await page.click('#save-new');
  await expect(page.locator('.xls tbody:not(.xls-new) input[value="Aceite QA"]')).toHaveCount(1);
  await page.locator('.seg-btn[data-view="cards"]').click();
  // un comercio normal NO debe ver la pestaña ni el botón Admin
  await expect(page.locator('.tab[data-nav="admin"]')).toHaveCount(0);
  await expect(page.locator('.btn-admin')).toHaveCount(0);
  expect(errors, `errores de consola:\n${errors.join('\n')}`).toEqual([]);
});

test('panel: la cuenta root ve la pestaña Admin y abre el panel', async ({ page }) => {
  await login(page, 'root@test.local');
  await expect(page.locator('.user-email')).toHaveText('root@test.local', { timeout: 10000 });
  // botón Admin fijo en la barra superior (siempre visible, no depende del scroll del nav)
  const adminBtn = page.locator('.btn-admin');
  await expect(adminBtn).toBeVisible({ timeout: 10000 }); // aparece tras detectRoot
  await adminBtn.click();
  await expect(page.locator('.view-head h1')).toContainText('Administración');
});

test('storefront: la landing carga el menú', async ({ page }) => {
  await page.goto('/r/qa-demo');
  await expect(page.locator('.hero h1')).toBeVisible();
  await expect(page.locator('.prod').first()).toBeVisible();
});
