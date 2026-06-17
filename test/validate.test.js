import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// validate.js -> logger.js -> env.js valida estas vars al importar; las seteamos antes
// del import dinámico para poder testear sin un .env real.
process.env.MONGODB_URI ||= 'mongodb://localhost/test';
process.env.JWT_SECRET ||= 'test-secret';
const { validate, errorHandler } = await import('../src/middleware/validate.js');

test('validate deja pasar datos válidos y reemplaza por los parseados', () => {
  const mw = validate(z.object({ name: z.string().min(2) }));
  const req = { body: { name: 'ok', extra: 'descartado' } };
  let err;
  mw(req, {}, (e) => { err = e; });
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { name: 'ok' }); // zod descarta lo no declarado
});

test('validate rechaza datos inválidos con 400', () => {
  const mw = validate(z.object({ name: z.string().min(2) }));
  let err;
  mw({ body: { name: 'a' } }, {}, (e) => { err = e; });
  assert.equal(err.status, 400);
  assert.equal(err.code, 'BAD_REQUEST');
});

test('errorHandler oculta detalle en errores 500 y expone el de 4xx', () => {
  const collect = () => {
    let code; let body;
    const res = { status(c) { code = c; return this; }, json(b) { body = b; } };
    return { res, get: () => ({ code, body }) };
  };

  const c1 = collect();
  errorHandler({ status: 400, code: 'BAD_REQUEST', message: 'slug inválido' }, {}, c1.res, () => {});
  assert.equal(c1.get().code, 400);
  assert.equal(c1.get().body.error.message, 'slug inválido');

  const c2 = collect();
  errorHandler(new Error('detalle interno'), {}, c2.res, () => {});
  assert.equal(c2.get().code, 500);
  assert.equal(c2.get().body.error.message, 'Error interno'); // no filtra el detalle
});
