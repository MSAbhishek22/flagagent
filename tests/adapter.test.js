/* FlagAgent — mock adapter tests. Run: node tests/adapter.test.js */
'use strict';
const assert = require('assert');
const { buildSeedProject } = require('../js/seed.js');
const { MockAdapter, createAdapter } = require('../js/adapter.js');

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok — ' + name); });
}

(async function () {
  console.log('mock adapter');

  await check('seed loads with 3 environments, 6 flags, 3 segments', async () => {
    const a = new MockAdapter(buildSeedProject());
    const d = await a.describe();
    assert.strictEqual(d.mode, 'MOCK');
    const snap = await a.snapshot();
    assert.strictEqual(snap.environments.length, 3);
    assert.strictEqual(snap.segments.length, 3);
    assert.strictEqual(snap.featuresByEnv['env-prod'].length, 6);
  });

  await check('createAdapter falls back to MOCK without a key', async () => {
    const a = createAdapter({}, buildSeedProject());
    assert.strictEqual(a.mode, 'MOCK');
    const b = createAdapter({ mode: 'LIVE', apiKey: '', projectId: '1' }, buildSeedProject());
    assert.strictEqual(b.mode, 'MOCK');
  });

  await check('set_rollout applies and reads back exactly', async () => {
    const a = new MockAdapter(buildSeedProject());
    const r = await a.applyChange({ kind: 'set_rollout', envId: 'env-prod', feature: 'search_v2', after: { rollout: 60 } });
    assert.strictEqual(r.ok, true);
    const st = await a.getFeatureState('env-prod', 'search_v2');
    assert.strictEqual(st.rollout, 60);
  });

  await check('set_enabled keeps the rollout setting (separate fields)', async () => {
    const a = new MockAdapter(buildSeedProject());
    await a.applyChange({ kind: 'set_enabled', envId: 'env-prod', feature: 'search_v2', after: { enabled: false } });
    const st = await a.getFeatureState('env-prod', 'search_v2');
    assert.deepStrictEqual([st.enabled, st.rollout], [false, 25]);
  });

  await check('create_feature adds the flag OFF in every environment', async () => {
    const a = new MockAdapter(buildSeedProject());
    const r = await a.applyChange({ kind: 'create_feature', envId: 'env-prod', feature: 'dark_mode', after: { description: '', variants: null } });
    assert.strictEqual(r.ok, true);
    for (const env of ['env-dev', 'env-staging', 'env-prod']) {
      const st = await a.getFeatureState(env, 'dark_mode');
      assert.strictEqual(st.enabled, false);
    }
    const dup = await a.applyChange({ kind: 'create_feature', envId: 'env-prod', feature: 'dark_mode', after: { variants: null } });
    assert.strictEqual(dup.ok, false);
  });

  await check('unknown flag writes are refused, not faked', async () => {
    const a = new MockAdapter(buildSeedProject());
    const r = await a.applyChange({ kind: 'set_enabled', envId: 'env-prod', feature: 'nope_flag', after: { enabled: true } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(await a.getFeatureState('env-prod', 'nope_flag'), null);
  });

  await check('segment override applies for one segment only', async () => {
    const a = new MockAdapter(buildSeedProject());
    await a.applyChange({ kind: 'set_segment_override', envId: 'env-staging', feature: 'new_checkout', after: { segment: 'beta_users', enabled: true, value: null } });
    const st = await a.getFeatureState('env-staging', 'new_checkout');
    assert.strictEqual(st.segmentOverrides.length, 1);
    assert.strictEqual(st.segmentOverrides[0].segment, 'beta_users');
    const prod = await a.getFeatureState('env-prod', 'new_checkout');
    assert.strictEqual(prod.segmentOverrides.length, 0);
  });

  await check('set_variants stores weights that sum to 100', async () => {
    const a = new MockAdapter(buildSeedProject());
    const variants = [ { key: 'control', value: 'A', weight: 70 }, { key: 'variant_b', value: 'B', weight: 30 } ];
    await a.applyChange({ kind: 'set_variants', envId: 'env-prod', feature: 'headline_test', after: { variants } });
    const st = await a.getFeatureState('env-prod', 'headline_test');
    assert.strictEqual(st.variants.reduce((s, v) => s + v.weight, 0), 100);
    assert.strictEqual(st.variants[0].weight, 70);
  });

  await check('adapter state is isolated between instances', async () => {
    const a = new MockAdapter(buildSeedProject());
    const b = new MockAdapter(buildSeedProject());
    await a.applyChange({ kind: 'set_enabled', envId: 'env-prod', feature: 'new_checkout', after: { enabled: true } });
    const stb = await b.getFeatureState('env-prod', 'new_checkout');
    assert.strictEqual(stb.enabled, false);
  });

  console.log('adapter.test.js — ' + passed + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
