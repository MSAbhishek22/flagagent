/* FlagAgent — live adapter v2 FEATURE VERSIONING write tests.
   Run: node tests/adapter-versions.test.js
   Stubs global fetch with a small stateful Flagsmith world and checks
   the version write flow against the live swagger
   (api.flagsmith.com/api/v1/swagger.json, read 26 Nov 2026):
   - Project 54209's environments use v2 feature versioning, proven by
     the API's own words in a live run: the legacy featurestates PUT
     answered 400 {"detail":"This environment uses v2 feature versioning.
     Use the environment feature version endpoint instead."} while reads
     on the same route passed.
   - The version flow: GET|POST /environments/{envPk}/features/{featurePk}/versions/
     (environment_pk is the NUMERIC id here), PUT the state inside the
     version at .../versions/{uuid}/featurestates/{id}/ with a
     CustomEnvironmentFeatureVersionFeatureState body (feature_state_value
     REQUIRED, the nested object; read-only keys never sent), then
     POST .../versions/{uuid}/publish/.
   - Detection: the environments list flag use_v2_feature_versioning
     when present; otherwise the versioning 400 latches the env to v2. */
'use strict';
const assert = require('assert');
const { RealAdapter } = require('../js/adapter.js');

const ENV_ID = '116564';
const ENV_KEY = 'env-key-abc';
const BASE = 'https://api.flagsmith.com/api/v1';
const VERSIONING_400 = '{"detail":"This environment uses v2 feature versioning. Use the environment feature version endpoint instead."}';
const ALL_CALLS = [];

function makeWorld(opts) {
  opts = opts || {};
  const calls = [];
  const versions = (opts.drafts || []).map(function (v) {
    return { uuid: v.uuid, published: !!v.published, is_live: !!v.published, live_from: null, description: '' };
  });
  let versionSeq = 0;
  const statesByVersion = {};
  function statesFor(uuid) {
    if (!statesByVersion[uuid]) {
      statesByVersion[uuid] = [{ id: 7001, feature: 77, environment: 116564, enabled: false,
        feature_state_value: { type: 'unicode', string_value: null, integer_value: null, boolean_value: null },
        feature_segment: null, identity: null, multivariate_feature_state_values: [] }];
    }
    return statesByVersion[uuid];
  }
  function ok(payload, status) {
    return Promise.resolve({ ok: true, status: status || 200,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)) });
  }
  const fetchStub = function (url, options) {
    const method = (options && options.method) || 'GET';
    const body = options && options.body ? JSON.parse(options.body) : null;
    const rec = { method: method, url: url, body: body };
    calls.push(rec); ALL_CALLS.push(rec);

    if (url.endsWith('/projects/54209/environments/')) {
      const env = { id: 116564, name: 'Development', api_key: ENV_KEY };
      if (opts.v2Flag !== undefined) env.use_v2_feature_versioning = opts.v2Flag;
      return ok([env]);
    }
    if (url.endsWith('/projects/54209/features/')) {
      return ok({ results: [{ id: 77, name: 'test_flag', type: 'STANDARD', description: '' }] });
    }
    if (url.endsWith('/environments/' + ENV_KEY + '/featurestates/')) {
      return ok({ results: [{ id: 1875459, feature: 77, environment: 116564, enabled: false,
                              feature_state_value: null, multivariate_feature_state_values: [] }] });
    }
    if (method === 'PUT' && url.indexOf('/environments/' + ENV_KEY + '/featurestates/') !== -1) {
      // The live behaviour of project 54209: legacy writes rejected.
      return Promise.resolve({ ok: false, status: 400,
        text: () => Promise.resolve(VERSIONING_400), json: () => Promise.resolve({}) });
    }
    const vBase = BASE + '/environments/' + ENV_ID + '/features/77/versions/';
    if (url === vBase && method === 'GET') return ok({ count: versions.length, results: versions.slice() });
    if (url === vBase && method === 'POST') {
      versionSeq += 1;
      const v = { uuid: 'ver-uuid-' + versionSeq, published: false, is_live: false,
                  live_from: null, description: body && body.description };
      versions.unshift(v);
      return ok(v, 201);
    }
    if (url.indexOf(vBase) === 0) {
      const parts = url.slice(vBase.length).split('/').filter(Boolean);
      const uuid = parts[0];
      if (parts[1] === 'publish' && method === 'POST') {
        versions.forEach(function (v) { if (v.uuid === uuid) { v.published = true; v.is_live = true; } });
        return ok({});
      }
      if (parts[1] === 'featurestates' && method === 'GET') return ok(statesFor(uuid).slice());
      if (parts[1] === 'featurestates' && method === 'PUT') {
        const st = statesFor(uuid)[0];
        Object.assign(st, body);
        return ok(st);
      }
      if (parts[1] === 'featurestates' && method === 'POST') {
        const st = Object.assign({ id: 7002, feature: 77, environment: 116564,
                                   feature_segment: null, identity: null,
                                   multivariate_feature_state_values: [] }, body);
        statesFor(uuid).push(st);
        return ok(st, 201);
      }
    }
    return Promise.resolve({ ok: false, status: 404,
      text: () => Promise.resolve('{"detail":"not found"}'), json: () => Promise.resolve({}) });
  };
  return { calls: calls, fetchStub: fetchStub, versions: versions };
}

function idx(calls, method, urlPart) {
  return calls.findIndex(c => c.method === method && c.url.indexOf(urlPart) !== -1);
}
function createVersionIdx(calls) {
  // Exact collection URL — the publish URL contains the same substring.
  const vBase = BASE + '/environments/' + ENV_ID + '/features/77/versions/';
  return calls.findIndex(c => c.method === 'POST' && c.url === vBase);
}
function versionPut(calls, uuid) {
  return calls.filter(c => c.method === 'PUT' && c.url.indexOf('/versions/' + uuid + '/featurestates/') !== -1)[0];
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok — ' + name); });
}

(async function () {
  console.log('live adapter v2 versioning writes (stubbed fetch)');

  /* Scenario A — no flag on the environments list: the legacy PUT is
     tried first, answered with the exact live versioning 400, and the
     adapter switches to the version flow in order and latches. */
  const worldA = makeWorld({});
  global.fetch = worldA.fetchStub;
  const a = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });
  await a.listFeatures(ENV_ID); // learns state ids + raw states, as the board does

  await check('the versioning 400 on the legacy PUT triggers create version -> update state -> publish, in order', async () => {
    const r = await a.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, true, r.detail);
    assert.strictEqual(r.detail, 'test_flag is now ON.');
    const c = worldA.calls;
    const legacyPut = idx(c, 'PUT', '/environments/' + ENV_KEY + '/featurestates/1875459/');
    const getVersions = idx(c, 'GET', '/features/77/versions/');
    const postVersion = createVersionIdx(c);
    const getStates = idx(c, 'GET', '/versions/ver-uuid-1/featurestates/');
    const putState = idx(c, 'PUT', '/versions/ver-uuid-1/featurestates/7001/');
    const publish = idx(c, 'POST', '/versions/ver-uuid-1/publish/');
    assert.ok(legacyPut !== -1 && getVersions > legacyPut, 'versions are listed after the rejected legacy PUT');
    assert.ok(postVersion > getVersions, 'no draft existed, so a version is created');
    assert.ok(getStates > postVersion, 'the version states are read after creation');
    assert.ok(putState > getStates, 'the state is updated inside the version');
    assert.ok(publish > putState, 'the version is published after the update');
    assert.strictEqual(publish, c.length - 1, 'publish is the last call — nothing is written after it');
  });

  await check('the version-state PUT body matches CustomEnvironmentFeatureVersionFeatureState', async () => {
    const put = versionPut(worldA.calls, 'ver-uuid-1');
    assert.ok(put, 'a version-state PUT happened');
    assert.strictEqual(put.body.enabled, true);
    assert.deepStrictEqual(put.body.feature_state_value,
      { type: 'unicode', string_value: null, integer_value: null, boolean_value: null });
    ['id', 'feature', 'environment', 'identity', 'change_request', 'uuid', 'live_from',
     'created_at', 'updated_at', 'deleted_at', 'percentage'].forEach(function (k) {
      assert.ok(!(k in put.body), 'read-only or invented key in the version-state body: ' + k);
    });
    const create = worldA.calls[createVersionIdx(worldA.calls)];
    const CREATE_WRITABLE = ['live_from', 'description', 'feature_states_to_create',
                             'feature_states_to_update', 'segment_ids_to_delete_overrides', 'publish_immediately'];
    Object.keys(create.body).forEach(function (k) {
      assert.ok(CREATE_WRITABLE.indexOf(k) !== -1, 'non-writable key in the version create body: ' + k);
    });
  });

  await check('once latched, the next change goes straight to the version flow (no legacy PUT)', async () => {
    worldA.calls.length = 0;
    const r = await a.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: false } });
    assert.strictEqual(r.ok, true, r.detail);
    assert.strictEqual(idx(worldA.calls, 'PUT', '/featurestates/1875459/'), -1, 'no legacy PUT after latching');
    assert.ok(idx(worldA.calls, 'POST', '/versions/ver-uuid-2/publish/') !== -1,
      'the first version is published by now, so a second version is created and published');
  });

  /* Scenario B — the environments list carries the flag: no legacy
     write is attempted at all. */
  const worldB = makeWorld({ v2Flag: true });
  global.fetch = worldB.fetchStub;
  const b = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });
  await b.listFeatures(ENV_ID);

  await check('with use_v2_feature_versioning on the environment, writes skip the legacy route entirely', async () => {
    const r = await b.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, true, r.detail);
    assert.ok(!worldB.calls.some(c => c.method === 'PUT' && c.url.indexOf(ENV_KEY) !== -1),
      'no legacy featurestates PUT was attempted');
    const c = worldB.calls;
    assert.ok(createVersionIdx(c) !== -1 && createVersionIdx(c) < idx(c, 'PUT', '/versions/ver-uuid-1/featurestates/7001/'));
    assert.ok(idx(c, 'PUT', '/versions/ver-uuid-1/featurestates/7001/') < idx(c, 'POST', '/versions/ver-uuid-1/publish/'));
  });

  await check('set_value in a version writes the nested feature_state_value and never touches the v1 value route', async () => {
    const r = await b.applyChange({ kind: 'set_value', envId: ENV_ID, feature: 'test_flag', after: { value: 'hello' } });
    assert.strictEqual(r.ok, true, r.detail);
    const put = versionPut(worldB.calls, 'ver-uuid-2');
    assert.ok(put, 'the value change went into a fresh version (the first is published)');
    assert.deepStrictEqual(put.body.feature_state_value,
      { type: 'unicode', string_value: 'hello', integer_value: null, boolean_value: null });
    assert.strictEqual(put.body.enabled, false, 'enabled is preserved from the fetched state');
    assert.ok(!worldB.calls.some(c => c.url.indexOf('/features/featurestates/') !== -1),
      'the v1 value route /features/featurestates/ was never called');
  });

  /* Scenario C — an unpublished draft already exists: it is reused,
     not replaced. */
  const worldC = makeWorld({ v2Flag: true, drafts: [{ uuid: 'draft-9', published: false }] });
  global.fetch = worldC.fetchStub;
  const cc = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });
  await cc.listFeatures(ENV_ID);

  await check('an existing draft version is reused and published, not recreated', async () => {
    const r = await cc.applyChange({ kind: 'set_enabled', envId: ENV_ID, feature: 'test_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, true, r.detail);
    assert.strictEqual(createVersionIdx(worldC.calls), -1, 'no version was created');
    assert.ok(idx(worldC.calls, 'PUT', '/versions/draft-9/featurestates/7001/') !== -1);
    assert.ok(idx(worldC.calls, 'POST', '/versions/draft-9/publish/') !== -1);
  });

  /* Scenario D — rollout semantics are the same inside a version:
     0/100 map to enabled, a partial rollout is refused before any call. */
  const worldD = makeWorld({ v2Flag: true });
  global.fetch = worldD.fetchStub;
  const d = new RealAdapter({ apiKey: 'org-key', projectId: '54209' });
  await d.listFeatures(ENV_ID);

  await check('a partial rollout on a v2 environment is refused plainly and sends nothing', async () => {
    const before = worldD.calls.length;
    const r = await d.applyChange({ kind: 'set_rollout', envId: ENV_ID, feature: 'test_flag', after: { rollout: 50 } });
    assert.strictEqual(r.ok, false);
    assert.ok(/no percentage field/.test(r.detail), 'refusal names the real cause');
    assert.strictEqual(worldD.calls.length, before, 'the refusal happens before any API call');
  });

  await check('set_rollout 100 inside a version writes enabled true and publishes', async () => {
    const r = await d.applyChange({ kind: 'set_rollout', envId: ENV_ID, feature: 'test_flag', after: { rollout: 100 } });
    assert.strictEqual(r.ok, true, r.detail);
    const put = versionPut(worldD.calls, 'ver-uuid-1');
    assert.ok(put && put.body.enabled === true);
    assert.ok(idx(worldD.calls, 'POST', '/versions/ver-uuid-1/publish/') !== -1);
  });

  await check('no call ever addresses the legacy featurestates route by numeric environment id', async () => {
    assert.ok(!ALL_CALLS.some(c => /\/environments\/116564\/featurestates\//.test(c.url)),
      'the versions family uses /environments/{pk}/features/... — never /environments/{pk}/featurestates/');
  });

  console.log('adapter-versions.test.js — ' + passed + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
