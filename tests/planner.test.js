/* FlagAgent — planner + executor tests. Run: node tests/planner.test.js */
'use strict';
const assert = require('assert');
const { buildSeedProject } = require('../js/seed.js');
const { MockAdapter } = require('../js/adapter.js');
const planner = require('../js/planner.js');
const executor = require('../js/executor.js');

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok — ' + name); });
}
function freshAdapter() { return new MockAdapter(buildSeedProject()); }

(async function () {
  console.log('planner + executor');

  await check('headline rollout instruction parses to enable + rollout with a holding guard', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production, only if the payments kill switch stays off', snap);
    assert.strictEqual(plan.status, 'ready');
    assert.strictEqual(plan.envName, 'Production');
    assert.strictEqual(plan.changes.length, 2);
    assert.strictEqual(plan.changes[0].kind, 'set_enabled');
    assert.strictEqual(plan.changes[1].kind, 'set_rollout');
    assert.strictEqual(plan.changes[1].after.rollout, 10);
    assert.strictEqual(plan.guards.length, 1);
    assert.strictEqual(plan.guards[0].feature, 'payments_kill_switch');
    assert.strictEqual(plan.guards[0].status, 'holding');
    assert.ok(plan.hash && plan.hash.length === 8);
  });

  await check('diff lines carry before and after in plain words', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production', snap);
    assert.ok(plan.changes[0].text.includes('OFF → ON'), plan.changes[0].text);
    assert.ok(plan.changes[1].text.includes('rollout 0% → 10%'), plan.changes[1].text);
  });

  await check('unnamed environment defaults to Production and says so', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Enable search_v2', snap);
    assert.strictEqual(plan.envName, 'Production');
    assert.ok(plan.assumptions.some(s => s.includes('Production')));
  });

  await check('enable in staging raises a half-on flag to full with one rollout change', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Enable search_v2 in staging', snap);
    assert.strictEqual(plan.status, 'ready');
    assert.strictEqual(plan.changes.length, 1);
    assert.strictEqual(plan.changes[0].kind, 'set_rollout');
    assert.deepStrictEqual([plan.changes[0].before.rollout, plan.changes[0].after.rollout], [50, 100]);
  });

  await check('turning off a live production flag is planned with a caution', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Turn off search_v2 in production', snap);
    assert.strictEqual(plan.changes.length, 1);
    assert.strictEqual(plan.changes[0].kind, 'set_enabled');
    assert.strictEqual(plan.changes[0].caution, true);
    assert.ok(plan.warnings.some(w => w.includes('live for 25%')));
  });

  await check('create with named variants split 50/50 plans a multivariate flag', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Create a flag called promo_banner with variants control and spring_sale split 50/50', snap);
    assert.strictEqual(plan.status, 'ready');
    assert.strictEqual(plan.changes[0].kind, 'create_feature');
    assert.deepStrictEqual(plan.changes[0].after.variants.map(v => v.key), ['control', 'spring_sale']);
    assert.strictEqual(plan.changes[0].after.variants.reduce((s, v) => s + v.weight, 0), 100);
  });

  await check('creating an existing flag name is blocked', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Create a flag called new_checkout', snap);
    assert.strictEqual(plan.status, 'blocked');
    assert.ok(plan.errors.some(e => e.includes('already exists')));
  });

  await check('variant weights that do not add to 100 are blocked with the real sum', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Test "Headline one" against "Headline two" on headline_test split 60/30', snap);
    assert.strictEqual(plan.status, 'blocked');
    assert.ok(plan.errors.some(e => e.includes('90%')), plan.errors.join(' | '));
  });

  await check('unknown flag gets a clarification, not a guess', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Enable magic_sparkles in production', snap);
    assert.strictEqual(plan.status, 'needs_clarification');
    assert.strictEqual(plan.changes.length, 0);
    assert.ok(plan.errors[0].includes('new_checkout'));
  });

  await check('a vague instruction is refused with examples', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Make the homepage better please', snap);
    assert.strictEqual(plan.status, 'needs_clarification');
    assert.strictEqual(plan.changes.length, 0);
  });

  await check('segment instruction plans an override, not a global change', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Enable new_checkout for beta users in staging', snap);
    assert.strictEqual(plan.changes.length, 1);
    assert.strictEqual(plan.changes[0].kind, 'set_segment_override');
    assert.strictEqual(plan.changes[0].after.segment, 'beta_users');
  });

  await check('remote config value parses from quotes', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Set shipping_banner_text to "Free shipping over ₹299" in production', snap);
    assert.strictEqual(plan.changes.length, 1);
    assert.strictEqual(plan.changes[0].kind, 'set_value');
    assert.strictEqual(plan.changes[0].after.value, 'Free shipping over ₹299');
  });

  await check('delete plans only with a typed-confirmation requirement', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Delete flag legacy_search', snap);
    assert.strictEqual(plan.changes.length, 1);
    assert.strictEqual(plan.changes[0].kind, 'delete_feature');
    assert.strictEqual(plan.changes[0].requiresTypedConfirm, 'legacy_search');
  });

  await check('executor applies the approved headline plan and reads it back', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production, only if the payments kill switch stays off', snap);
    const receipt = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), {}, planner);
    assert.strictEqual(receipt.refused, null);
    assert.strictEqual(receipt.applied.length, 2);
    assert.ok(receipt.applied.every(r => r.ok));
    const st = await a.getFeatureState('env-prod', 'new_checkout');
    assert.deepStrictEqual([st.enabled, st.rollout], [true, 10]);
  });

  await check('executor applies only the approved subset', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production', snap);
    const onlyRollout = plan.changes.filter(c => c.kind === 'set_rollout').map(c => c.id);
    const receipt = await executor.applyPlan(a, plan, onlyRollout, {}, planner);
    assert.strictEqual(receipt.applied.length, 1);
    assert.strictEqual(receipt.skipped.length, 1);
    const st = await a.getFeatureState('env-prod', 'new_checkout');
    assert.strictEqual(st.rollout, 10);
    assert.strictEqual(st.enabled, false); // the enable change was not approved, so it did not happen
  });

  await check('a guard already broken at plan time refuses the apply', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production, only if search_v2 stays off', snap);
    assert.strictEqual(plan.guards[0].status, 'violated');
    const receipt = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), {}, planner);
    assert.ok(receipt.refused && receipt.refused.includes('Guard broken'));
    const st = await a.getFeatureState('env-prod', 'new_checkout');
    assert.strictEqual(st.enabled, false);
  });

  await check('a guard broken after approval refuses the apply', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production, only if the payments kill switch stays off', snap);
    await a.applyChange({ kind: 'set_enabled', envId: 'env-prod', feature: 'payments_kill_switch', after: { enabled: true } });
    const receipt = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), {}, planner);
    assert.ok(receipt.refused && receipt.refused.includes('Guard broken at apply time'));
    const st = await a.getFeatureState('env-prod', 'new_checkout');
    assert.strictEqual(st.enabled, false);
  });

  await check('editing a plan after approval breaks the hash and refuses', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Release the new checkout to 10% of users in production', snap);
    plan.changes[1].after.rollout = 99;
    const receipt = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), {}, planner);
    assert.ok(receipt.refused && receipt.refused.includes('plan changed'));
  });

  await check('delete without the typed name is refused; with it, it applies', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Delete flag legacy_search', snap);
    const no = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), {}, planner);
    assert.ok(no.refused && no.refused.includes('typed exactly'));
    assert.ok(await a.getFeatureState('env-prod', 'legacy_search'));
    const yes = await executor.applyPlan(a, plan, plan.changes.map(c => c.id), { [plan.changes[0].id]: 'legacy_search' }, planner);
    assert.strictEqual(yes.refused, null);
    assert.strictEqual(await a.getFeatureState('env-prod', 'legacy_search'), null);
  });

  await check('approving nothing applies nothing', async () => {
    const a = freshAdapter(); const snap = await a.snapshot();
    const plan = planner.parseInstruction('Enable search_v2 in staging', snap);
    const receipt = await executor.applyPlan(a, plan, [], {}, planner);
    assert.ok(receipt.refused && receipt.refused.includes('Nothing was approved'));
  });

  console.log('planner.test.js — ' + passed + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
