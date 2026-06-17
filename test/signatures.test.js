import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hmacSha256Hex, safeEqualHex, buildMpManifest, verifyMpSignature, verifyMetaSignature,
} from '../src/utils/signatures.js';

test('buildMpManifest solo incluye campos presentes', () => {
  assert.equal(buildMpManifest({ dataId: '1', requestId: 'r', ts: '10' }), 'id:1;request-id:r;ts:10;');
  assert.equal(buildMpManifest({ ts: '10' }), 'ts:10;');
  assert.equal(buildMpManifest({ dataId: '1', ts: '10' }), 'id:1;ts:10;');
});

test('verifyMpSignature acepta una firma válida', () => {
  const secret = 'mp-secret';
  const ts = '1700000000';
  const dataId = '12345';
  const requestId = 'req-abc';
  const v1 = hmacSha256Hex(secret, buildMpManifest({ dataId, requestId, ts }));
  const ok = verifyMpSignature({
    signatureHeader: `ts=${ts},v1=${v1}`, requestId, dataId, secret,
  });
  assert.equal(ok, true);
});

test('verifyMpSignature rechaza firma alterada o secret incorrecto', () => {
  const ts = '1700000000';
  const dataId = '12345';
  const v1 = hmacSha256Hex('mp-secret', buildMpManifest({ dataId, ts }));
  assert.equal(verifyMpSignature({ signatureHeader: `ts=${ts},v1=${v1}`, dataId, secret: 'otro' }), false);
  assert.equal(verifyMpSignature({ signatureHeader: `ts=${ts},v1=deadbeef`, dataId, secret: 'mp-secret' }), false);
  assert.equal(verifyMpSignature({ signatureHeader: '', dataId, secret: 'mp-secret' }), false);
  assert.equal(verifyMpSignature({ signatureHeader: `ts=${ts}`, dataId, secret: 'mp-secret' }), false);
});

test('verifyMetaSignature valida la firma sha256 de Meta', () => {
  const appSecret = 'meta-secret';
  const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
  const header = 'sha256=' + hmacSha256Hex(appSecret, rawBody);
  assert.equal(verifyMetaSignature({ signatureHeader: header, rawBody, appSecret }), true);
  assert.equal(verifyMetaSignature({ signatureHeader: 'sha256=bad', rawBody, appSecret }), false);
  assert.equal(verifyMetaSignature({ signatureHeader: header, rawBody: null, appSecret }), false);
});

test('safeEqualHex es seguro ante longitudes distintas', () => {
  assert.equal(safeEqualHex('abc', 'abc'), true);
  assert.equal(safeEqualHex('abc', 'abcd'), false);
  assert.equal(safeEqualHex('abc', 'abd'), false);
});
