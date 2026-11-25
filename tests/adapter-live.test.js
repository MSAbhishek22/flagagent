/* FlagAgent — live adapter URL tests. Run: node tests/adapter-live.test.js
   Stubs global fetch and checks the RealAdapter talks to the routes the
   Flagsmith Management API actually defines (swagger, 25 Nov 2026):
   featurestates are addressed by the environment's api_key, never its
   numeric id — a numeric id is answered 403 (seen live, project 54209). */
'use strict';
const assert = require('assert');
const { RealAdapter } = require('../js/adapter.js');

const ENV_ID = '116564';
const ENV_KEY = 'env-key-abc';
const calls = [];

global.fetch = function (url, options) {
  const method = (options && options.method) || 'GET';
  calls.push(method + ' ' + url);
  let payload;
  if (url.endsWith('/projects/54209/environments/')) {
    payload = [{ id: 116564, name: 'Development', api_key: ENV_KEY }];
  } else if (url.endsWith('/projects/54209/features/')) {
    payload = { results: [{ id: 77, name: 'test_flag', type: 'STANDARD', description: '' }] };
  } else if (url.endsWith('/environments/' + ENV_KEY + '/featurestates/')) {
    payload = { results: [{ id: 9001, feature: 77, enabled: false, feature_state_value: null, multivariate_feature_state_values: [] }] };
  } else if (url.endsWith('/environments/' + ENV_KEY + '/featurestates/9001/')) {
    payload = {};
  } else {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
};

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok — ' + name); });
}

(async function () {
  console.log('live adapter (stubbed fetch)');
  const a = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });

  await check('listFeatures reads states via the environment api_key URL', async () => {
    const feats = await a.listFeatures(ENV_ID);
    assert.strictEqual(feats.length, 1);
    assert.strictEqual(feats[0].name, 'test_flag');
    assert.strictEqual(feats[0].state.enabled, false);
    assert.ok(calls.some(c => c === 'GET https://api.flagsmith.com/api/v1/environments/' + ENV_KEY + '/featurestates/'));
  });

  await check('environments list does not leak the api_key to callers', async () => {
    const envs = await a.listEnvironments();
    assert.deepStrictEqual(envs, [{ id: ENV_ID, name: 'Development' }]);
  });

  await check('applyChange writes via the environment api_key URL', async () => {
    const r = await a.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, true);
    assert.ok(calls.some(c => c === 'PUT https://api.flagsmith.com/api/v1/environments/' + ENV_KEY + '/featurestates/9001/'));
  });

  await check('no call ever addresses featurestates by numeric environment id', async () => {
    assert.ok(!calls.some(c => c.includes('/environments/' + ENV_ID + '/')));
  });

  console.log('adapter-live.test.js — ' + passed + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
