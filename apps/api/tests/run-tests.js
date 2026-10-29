const assert = require('assert');
const { createApp } = require('../apps/api/src/app');

(async () => {
  const app = createApp();

  // health check
  const healthResp = await app.fetch(new Request('http://localhost/api/health'));
  assert.strictEqual(healthResp.status, 200, 'Health endpoint should return 200');
  const healthJson = await healthResp.json();
  assert.deepStrictEqual(healthJson, { ok: true, service: 'leandrosys', time: healthJson.time }, 'Health payload mismatch');

  // unknown route
  const notFoundResp = await app.fetch(new Request('http://localhost/api/unknown'));
  assert.strictEqual(notFoundResp.status, 404, 'Unknown route should return 404');
  const notFoundJson = await notFoundResp.json();
  assert.deepStrictEqual(notFoundJson, { error: 'Rota não encontrada', code: 'NOT_FOUND' }, '404 payload mismatch');

  console.log('All integration tests passed');
})();
