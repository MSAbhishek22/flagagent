/* FlagBench-20 — runner.
   Run: node bench/run_bench.js [--out bench/results-<label>.json]

   Drives the REAL planner, executor and adapter through the 20 fixed
   cases in bench/cases.js and reports, measured:
     - plans produced correctly, out of 20
     - traps caught, out of 5 (a trap is caught when the plan flags it
       and nothing wrong is written)
     - unapproved writes (must be zero — and is only claimed if the
       run shows zero)

   Today this runner drives the MockAdapter (the demo project), because
   the real adapter needs the user's key in a browser page's memory —
   the key never enters a script. A run through this file is therefore
   a MOCK rehearsal, labelled as such in its output. The scored run is
   the same 20 cases against the real Flagsmith project in the window,
   worked through the live page (see LIVE_RUN_CHECKLIST.md); its numbers
   are recorded separately and are the only numbers the filing may use.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSeedProject } = require('../js/seed.js');
const { MockAdapter } = require('../js/adapter.js');
const planner = require('../js/planner.js');
const executor = require('../js/executor.js');
const { CASES } = require('./cases.js');

function envIdByName(snap, name) {
  const e = snap.environments.find(x => x.name.toLowerCase() === String(name).toLowerCase());
  return e ? e.id : null;
}
function envNameById(snap, id) {
  const e = snap.environments.find(x => x.id === id);
  return e ? e.name : id;
}

async function arrange(adapter, snap, steps) {
  for (const s of steps || []) {
    const envId = envIdByName(snap, s.env);
    const r = await adapter.applyChange({ kind: s.kind, envId: envId, feature: s.feature, after: s.after });
    if (!r.ok) throw new Error('bench setup failed: ' + JSON.stringify(s) + ' → ' + (r.detail || 'not ok'));
  }
}

async function finalState(adapter, snap, checks) {
  const failures = [];
  for (const c of checks || []) {
    const envId = envIdByName(snap, c.env);
    const feats = await adapter.listFeatures(envId);
    const f = feats.find(x => x.name === c.feature);
    if (c.exists === true && !f) { failures.push(c.feature + ' should exist in ' + c.env + ' but does not'); continue; }
    if (c.exists === false) { if (f) failures.push(c.feature + ' should be gone from ' + c.env + ' but still exists'); continue; }
    if (!f) { failures.push(c.feature + ' not found in ' + c.env); continue; }
    if (c.enabled !== undefined && f.state.enabled !== c.enabled)
      failures.push(c.feature + ' in ' + c.env + ': enabled is ' + f.state.enabled + ', expected ' + c.enabled);
    if (c.rollout !== undefined && f.state.rollout !== c.rollout)
      failures.push(c.feature + ' in ' + c.env + ': rollout is ' + f.state.rollout + ', expected ' + c.rollout);
    if (c.overrideEnabled !== undefined) {
      const has = (f.state.segmentOverrides || []).some(o => o.enabled === c.overrideEnabled);
      if (!has) failures.push(c.feature + ' in ' + c.env + ': no segment override with enabled=' + c.overrideEnabled);
    }
  }
  return failures;
}

async function runCase(tc) {
  const adapter = new MockAdapter(buildSeedProject());
  const detail = { id: tc.id, group: tc.group, title: tc.title, instruction: tc.instruction };
  const planFailures = [], outcomeFailures = [];

  let snap = await adapter.snapshot();
  await arrange(adapter, snap, tc.setup);
  snap = await adapter.snapshot();

  const plan = planner.parseInstruction(tc.instruction, snap);
  detail.planStatus = plan.status;
  detail.planChanges = plan.changes.map(c => ({
    kind: c.kind, feature: c.feature, env: envNameById(snap, c.envId || plan.envId),
    before: c.before || null, after: c.after || null
  }));
  detail.planGuards = plan.guards;
  detail.planText = (plan.errors || []).concat(plan.warnings || []);

  /* --- plan assertions --- */
  const exp = tc.expect.plan || {};
  if (exp.status === 'ready' && plan.status !== 'ready')
    planFailures.push('plan status is "' + plan.status + '", expected "ready" (' + detail.planText.join(' | ') + ')');
  if (exp.status === 'not-ready' && plan.status === 'ready')
    planFailures.push('plan is "ready" but this case must not produce a ready plan');
  if (exp.changes) {
    if (plan.changes.length !== exp.changes.length)
      planFailures.push('plan has ' + plan.changes.length + ' change(s), expected ' + exp.changes.length);
    exp.changes.forEach((ec, i) => {
      const ac = plan.changes[i];
      if (!ac) return;
      if (ec.kind && ac.kind !== ec.kind) planFailures.push('change ' + (i + 1) + ': kind is ' + ac.kind + ', expected ' + ec.kind);
      if (ec.feature && ac.feature !== ec.feature) planFailures.push('change ' + (i + 1) + ': feature is ' + ac.feature + ', expected ' + ec.feature);
      if (ec.env && envNameById(snap, ac.envId || plan.envId) !== ec.env)
        planFailures.push('change ' + (i + 1) + ': env is ' + envNameById(snap, ac.envId || plan.envId) + ', expected ' + ec.env);
      if (ec.afterEnabled !== undefined && (!ac.after || ac.after.enabled !== ec.afterEnabled))
        planFailures.push('change ' + (i + 1) + ': after.enabled is ' + (ac.after && ac.after.enabled) + ', expected ' + ec.afterEnabled);
      if (ec.afterRollout !== undefined && (!ac.after || ac.after.rollout !== ec.afterRollout))
        planFailures.push('change ' + (i + 1) + ': after.rollout is ' + (ac.after && ac.after.rollout) + ', expected ' + ec.afterRollout);
      if (ec.beforeRollout !== undefined && (!ac.before || ac.before.rollout !== ec.beforeRollout))
        planFailures.push('change ' + (i + 1) + ': before.rollout is ' + (ac.before && ac.before.rollout) + ', expected ' + ec.beforeRollout + ' (the live value, not an assumption)');
    });
  }
  if (exp.guard) {
    const g = plan.guards.find(x => x.feature === exp.guard.feature);
    if (!g) planFailures.push('no guard on ' + exp.guard.feature + ' in the plan');
    else if (exp.guard.status && g.status !== exp.guard.status)
      planFailures.push('guard on ' + exp.guard.feature + ' is "' + g.status + '", expected "' + exp.guard.status + '"');
  }
  if (exp.textIncludes) {
    const hay = detail.planText.join(' ').toLowerCase();
    if (!hay.includes(exp.textIncludes.toLowerCase()))
      planFailures.push('plan text does not mention "' + exp.textIncludes + '" (got: ' + detail.planText.join(' | ') + ')');
  }

  /* --- apply phase, with write counting --- */
  let applyWrites = 0; const appliedIds = [];
  const origApply = adapter.applyChange.bind(adapter);
  adapter.applyChange = function (change) {
    applyWrites++; if (change && change.id) appliedIds.push(change.id);
    return origApply(change);
  };

  let approvedIds = [];
  if (tc.approve === 'all') approvedIds = plan.changes.map(c => c.id);
  else if (tc.approve && tc.approve.env)
    approvedIds = plan.changes.filter(c => envNameById(snap, c.envId || plan.envId) === tc.approve.env).map(c => c.id);
  const typedConfirms = {};
  if (tc.typed === 'auto') plan.changes.forEach(c => { if (c.requiresTypedConfirm) typedConfirms[c.id] = c.requiresTypedConfirm; });

  let result = null;
  if (tc.expect.apply !== 'skip' && plan.status === 'ready') {
    await arrange(adapter, snap, tc.between);
    applyWrites = 0; appliedIds.length = 0; // setup/between writes are scaffolding, not the apply phase
    result = await executor.applyPlan(adapter, plan, approvedIds, typedConfirms, planner);
  }
  detail.applyWrites = applyWrites;
  detail.appliedIds = appliedIds.slice();
  detail.unapprovedWrites = appliedIds.filter(id => !approvedIds.includes(id)).length;
  if (result) detail.applyResult = { refused: result.refused || null, summary: result.summary || null,
                                     applied: (result.applied || []).map(a => ({ feature: a.change.feature, ok: a.ok })) };

  /* --- outcome assertions --- */
  if (tc.expect.apply === 'applied') {
    if (!result) outcomeFailures.push('no apply ran (plan was not ready)');
    else {
      if (result.refused) outcomeFailures.push('apply refused: ' + result.refused);
      (result.applied || []).forEach(a => { if (!a.ok) outcomeFailures.push('change on ' + a.change.feature + ' did not read back'); });
      const skippedExpected = plan.changes.length - approvedIds.length;
      if ((result.skipped || []).length !== skippedExpected)
        outcomeFailures.push('skipped count is ' + (result.skipped || []).length + ', expected ' + skippedExpected);
    }
  }
  if (tc.expect.apply === 'refused') {
    if (!result) outcomeFailures.push('no apply ran, so the refusal was never tested');
    else if (!result.refused) outcomeFailures.push('apply was NOT refused, but this case must be refused');
  }
  if (tc.expect.zeroWrites && applyWrites !== 0)
    outcomeFailures.push(applyWrites + ' write(s) happened in the apply phase, expected zero');
  outcomeFailures.push(...await finalState(adapter, snap, tc.expect.final));

  detail.planOk = planFailures.length === 0;
  detail.outcomeOk = outcomeFailures.length === 0;
  detail.pass = detail.planOk && detail.outcomeOk;
  detail.failures = planFailures.concat(outcomeFailures);
  return detail;
}

(async function () {
  const outArg = process.argv.indexOf('--out');
  const results = [];
  for (const tc of CASES) {
    const d = await runCase(tc);
    results.push(d);
    console.log((d.pass ? 'PASS' : 'FAIL') + '  case ' + String(d.id).padStart(2) + '  ' + d.title);
    d.failures.forEach(f => console.log('        — ' + f));
  }
  const plansOk = results.filter(r => r.planOk).length;
  const casesOk = results.filter(r => r.pass).length;
  const traps = results.filter(r => r.group === 'trap');
  const trapsCaught = traps.filter(r => r.planOk && r.applyWrites === 0).length;
  const unapproved = results.reduce((n, r) => n + (r.unapprovedWrites || 0), 0);
  console.log('');
  console.log('FlagBench-20 — MOCK rehearsal (demo project, NOT the real Flagsmith project)');
  console.log('  plans produced correctly : ' + plansOk + ' / 20');
  console.log('  cases fully passing      : ' + casesOk + ' / 20');
  console.log('  traps caught             : ' + trapsCaught + ' / 5');
  console.log('  unapproved writes        : ' + unapproved);
  const payload = { bench: 'FlagBench-20', mode: 'MOCK rehearsal — demo project only; not the scored run',
                    ranAt: new Date().toISOString(), plansCorrect: plansOk, casesPassing: casesOk,
                    trapsCaught: trapsCaught, unapprovedWrites: unapproved, results: results };
  if (outArg > -1 && process.argv[outArg + 1]) {
    fs.writeFileSync(path.resolve(process.argv[outArg + 1]), JSON.stringify(payload, null, 2));
    console.log('  full results written to ' + process.argv[outArg + 1]);
  }
  process.exit(casesOk === 20 ? 0 : 1);
})().catch(e => { console.error('bench runner error: ' + e.message); process.exit(2); });
