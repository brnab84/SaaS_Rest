import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, notFound, badRequest, unauthorized, forbidden } from '../src/utils/errors.js';

test('los helpers de error producen status y code correctos', () => {
  assert.equal(notFound().status, 404);
  assert.equal(notFound().code, 'NOT_FOUND');
  assert.equal(badRequest().status, 400);
  assert.equal(badRequest().code, 'BAD_REQUEST');
  assert.equal(unauthorized().status, 401);
  assert.equal(unauthorized().code, 'UNAUTHORIZED');
  assert.equal(forbidden().status, 403);
  assert.equal(forbidden().code, 'FORBIDDEN');
});

test('AppError conserva el mensaje y es instancia de Error', () => {
  const e = badRequest('slug inválido');
  assert.ok(e instanceof AppError);
  assert.ok(e instanceof Error);
  assert.equal(e.message, 'slug inválido');
});
