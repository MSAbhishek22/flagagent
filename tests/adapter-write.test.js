/* FlagAgent — live adapter WRITE body tests. Run: node tests/adapter-write.test.js
   Stubs global fetch and checks the exact bodies RealAdapter.applyChange
   PUTs, against the Flagsmith swagger (api.flagsmith.com/api/v1/swagger.json,
   read 26 Nov 2026):
   - PUT /environments/{env api_key}/featurestates/{id}/ takes
     FeatureStateSerializerBasic: `feature` is REQUIRED, `enabled` is
     writable, `feature_state_value` is read-only there, and there is
     NO `percentage` field on a v1 feature state. The first live run
     sent {enabled} alone and every write came back 400.
   - Value writes take PUT /features/featurestates/{id}/
     (WritableNestedFeatureState): `environment` + `feature` required,
     feature_state_value is a nested {type, string_value, integer_value,
     boolean_value} with type in int / unicode / bool. */
'use strict';
const assert = require('assert');
const { RealAdapter } = require('../js/adapter.js');

const ENV_ID = '116564';
const ENV_KEY = 'env-key-abc';
const calls = []; // { method, url, body }

const FS_PLAIN = { id: 9001, feature: 77, environment: 116564, enabled: false,
                   feature_state_value: null, multivariate_feature_state_values: [],
                   live_from: null, version: 1, uuid: 'fs-9001', created_at: '2026-11-25T00:00:00Z' };
const FS_MV = { id: 9002, feature: 78, environment: 116564, enabled: true,
                feature_state_value: null,
                multivariate_feature_state_values: [
                  { id: 501, multivariate_feature_option: 61, percentage_allocation: 70 },
                  { id: 502, multivariate_feature_option: 62, percentage_allocation: 30 }
                ],
                live_from: null, version: 1, uuid: 'fs-9002', created_at: '2026-11-25T00:00:00Z' };

global.fetch = function (url, options) {
  const method = (options && options.method) || 'GET';
  calls.push({ method: method, url: url, body: options && options.body ? JSON.parse(options.body) : null });
  let payload;
  if (url.endsWith('/projects/54209/environments/')) {
    payload = [{ id: 116564, name: 'Development', api_key: ENV_KEY }];
  } else if (url.endsWith('/projects/54209/features/')) {
    payload = { results: [
      { id: 77, name: 'test_flag', type: 'STANDARD', description: '' },
      { id: 78, name: 'mv_flag', type: 'MULTIVARIATE', description: '' }
    ] };
  } else if (url.endsWith('/environments/' + ENV_KEY + '/featurestates/')) {
    payload = { results: [FS_PLAIN, FS_MV] };
  } else if (url.indexOf('/featurestates/') !== -1) {
    payload = {};
  } else {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
};

function puts() { return calls.filter(c => c.method === 'PUT'); }
function lastPut() { const p = puts(); return p[p.length - 1]; }

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok — ' + name); });
}

(async function () {
  console.log('live adapter write bodies (stubbed fetch)');
  const a = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });
  await a.listFeatures(ENV_ID); // learns state ids + raw states, as the board does

  await check('set_enabled PUT body carries the required feature and no read-only or invented fields', async () => {
    const r = await a.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, true);
    const put = lastPut();
    assert.strictEqual(put.url, 'https://api.flagsmith.com/api/v1/environments/' + ENV_KEY + '/featurestates/9001/');
    assert.strictEqual(put.body.feature, 77);
    assert.strictEqual(put.body.enabled, true);
    assert.strictEqual(put.body.environment, 116564);
    assert.ok(!('percentage' in put.body), 'no percentage field exists on a v1 feature state');
    ['id', 'uuid', 'version', 'created_at', 'updated_at', 'deleted_at', 'feature_state_value'].forEach(function (k) {
      assert.ok(!(k in put.body), 'read-only field leaked into the write body: ' + k);
    });
  });

  await check('set_rollout 100 and 0 map to enabled, with no percentage field sent', async () => {
    const r100 = await a.applyChange({ kind: 'set_rollout', envId: ENV_ID, feature: 'test_flag', after: { rollout: 100 } });
    assert.strictEqual(r100.ok, true);
    assert.strictEqual(lastPut().body.enabled, true);
    assert.strictEqual(lastPut().body.feature, 77);
    assert.ok(!('percentage' in lastPut().body));
    const r0 = await a.applyChange({ kind: 'set_rollout', envId: ENV_ID, feature: 'test_flag', after: { rollout: 0 } });
    assert.strictEqual(r0.ok, true);
    assert.strictEqual(lastPut().body.enabled, false);
  });

  await check('a partial rollout on a standard flag is refused plainly and sends nothing', async () => {
    const before = puts().length;
    const r = await a.applyChange({ kind: 'set_rollout', envId: ENV_ID, feature: 'test_flag', after: { rollout: 50 } });
    assert.strictEqual(r.ok, false);
    assert.ok(/no percentage field/.test(r.detail), 'refusal names the real cause');
    assert.strictEqual(puts().length, before);
  });

  await check('set_value PUTs the nested feature_state_value object to /features/featurestates/', async () => {
    const r = await a.applyChange({ kind: 'set_value', envId: ENV_ID, feature: 'test_flag', after: { value: 'hello' } });
    assert.strictEqual(r.ok, true);
    const put = lastPut();
    assert.strictEqual(put.url, 'https://api.flagsmith.com/api/v1/features/featurestates/9001/');
    assert.strictEqual(put.body.feature, 77);
    assert.strictEqual(put.body.environment, 116564);
    assert.strictEqual(put.body.enabled, false); // preserved from the fetched state
    assert.deepStrictEqual(put.body.feature_state_value,
      { type: 'unicode', string_value: 'hello', integer_value: null, boolean_value: null });
  });

  await check('set_value types numbers as int and booleans as bool', async () => {
    await a.applyChange({ kind: 'set_value', envId: ENV_ID, feature: 'test_flag', after: { value: 42 } });
    assert.deepStrictEqual(lastPut().body.feature_state_value,
      { type: 'int', string_value: null, integer_value: 42, boolean_value: null });
    await a.applyChange({ kind: 'set_value', envId: ENV_ID, feature: 'test_flag', after: { value: true } });
    assert.deepStrictEqual(lastPut().body.feature_state_value,
      { type: 'bool', string_value: null, integer_value: null, boolean_value: true });
  });

  await check('multivariate weights are preserved through an enabled write', async () => {
    const r = await a.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'mv_flag', after: { enabled: false } });
    assert.strictEqual(r.ok, true);
    const put = lastPut();
    assert.strictEqual(put.url, 'https://api.flagsmith.com/api/v1/environments/' + ENV_KEY + '/featurestates/9002/');
    assert.strictEqual(put.body.feature, 78);
    assert.deepStrictEqual(put.body.multivariate_feature_state_values, [
      { multivariate_feature_option: 61, percentage_allocation: 70, id: 501 },
      { multivariate_feature_option: 62, percentage_allocation: 30, id: 502 }
    ]);
  });

  await check('no call ever addresses featurestates by numeric environment id', async () => {
    assert.ok(!calls.some(c => c.url.includes('/environments/' + ENV_ID + '/')));
  });

  console.log('adapter-write.test.js — ' + passed + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
