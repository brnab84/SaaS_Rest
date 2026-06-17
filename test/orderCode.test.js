import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderCode } from '../src/utils/orderCode.js';

test('generateOrderCode tiene la longitud pedida', () => {
  assert.equal(generateOrderCode().length, 6);
  assert.equal(generateOrderCode(10).length, 10);
});

test('generateOrderCode evita caracteres ambiguos (I, O, 0, 1)', () => {
  const codes = Array.from({ length: 200 }, () => generateOrderCode(12)).join('');
  assert.match(codes, /^[A-HJ-NP-Z2-9]+$/); // sin I, O, 0, 1
});

test('generateOrderCode es razonablemente único', () => {
  const set = new Set(Array.from({ length: 1000 }, () => generateOrderCode()));
  assert.ok(set.size > 990, `esperaba alta unicidad, hubo ${1000 - set.size} colisiones`);
});
