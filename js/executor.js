/* FlagAgent — the executor.
   Applies ONLY the changes the human approved, in plan order, and reads
   every change back before calling it done. Three refusal rules:
   1. The plan hash must still match (nothing edited after approval).
   2. Every guard must still hold at apply time, checked on fresh state.
   3. A destructive change needs its typed confirmation.
   A refusal applies nothing at all.
*/
(function (global) {
  'use strict';

  function verify(change, state, exists) {
    switch (change.kind) {
      case 'create_feature': return exists === true;
      case 'delete_feature': return exists === false;
      case 'set_enabled': return !!state && state.enabled === change.after.enabled;
      case 'set_rollout': return !!state && state.rollout === change.after.rollout;
      case 'set_value': return !!state && state.value === change.after.value;
      case 'set_variants': {
        if (!state || !state.variants || !change.after.variants) return false;
        if (state.variants.length !== change.after.variants.length) return false;
        return change.after.variants.every(function (v, i) {
          return state.variants[i].key === v.key && state.variants[i].weight === v.weight;
        });
      }
      case 'set_segment_override': {
        if (!state) return false;
        return (state.segmentOverrides || []).some(function (o) {
          return o.segment === change.after.segment && o.enabled === change.after.enabled;
        });
      }
      default: return false;
    }
  }

  function applyPlan(adapter, plan, approvedIds, typedConfirms, planner) {
    typedConfirms = typedConfirms || {};
    var approved = {};
    (approvedIds || []).forEach(function (id) { approved[id] = true; });

    if (planner.planHash(plan.changes) !== plan.hash) {
      return Promise.resolve({ refused: 'The plan changed after it was shown. Re-plan and approve again.', applied: [], skipped: [] });
    }
    var chosen = plan.changes.filter(function (c) { return approved[c.id]; });
    var skipped = plan.changes.filter(function (c) { return !approved[c.id]; });
    if (!chosen.length) {
      return Promise.resolve({ refused: 'Nothing was approved, so nothing was applied.', applied: [], skipped: skipped });
    }
    for (var i = 0; i < chosen.length; i++) {
      var c = chosen[i];
      if (c.requiresTypedConfirm && typedConfirms[c.id] !== c.requiresTypedConfirm) {
        return Promise.resolve({ refused: 'The delete of ' + c.feature + ' needs its name typed exactly before it can run.', applied: [], skipped: skipped });
      }
    }

    var guardChecks = plan.guards.filter(function (g) { return g.feature && g.mustBe; });
    var guardChain = Promise.resolve();
    var guardFailure = null;
    guardChecks.forEach(function (g) {
      guardChain = guardChain.then(function () {
        if (guardFailure) return null;
        return adapter.getFeatureState(plan.envId, g.feature).then(function (st) {
          if (!st) { guardFailure = 'Guard flag ' + g.feature + ' could not be read back, so nothing was applied.'; return; }
          var holds = g.mustBe === 'off' ? !st.enabled : st.enabled;
          if (!holds) guardFailure = 'Guard broken at apply time: ' + g.feature + ' must be ' + g.mustBe.toUpperCase() + ' in ' + plan.envName + ', but it is not. Nothing was applied.';
        });
      });
    });

    return guardChain.then(function () {
      if (guardFailure) return { refused: guardFailure, applied: [], skipped: skipped };
      var applied = [];
      var chain = Promise.resolve();
      chosen.forEach(function (change) {
        chain = chain.then(function () {
          return adapter.applyChange(change).then(function (res) {
            if (!res.ok) { applied.push({ change: change, ok: false, detail: res.detail, readBack: null }); return null; }
            return adapter.listFeatures(change.envId).then(function (feats) {
              var found = null;
              feats.forEach(function (f) { if (f.name === change.feature) found = f; });
              var ok = verify(change, found ? found.state : null, !!found);
              applied.push({ change: change, ok: ok,
                detail: ok ? res.detail : res.detail + ' But the read-back does not match the plan.',
                readBack: found ? found.state : null });
            });
          });
        });
      });
      return chain.then(function () {
        var okCount = applied.filter(function (a) { return a.ok; }).length;
        return { refused: null, applied: applied, skipped: skipped,
                 summary: okCount + ' of ' + applied.length + ' approved changes applied and read back.' };
      });
    });
  }

  var api = { applyPlan: applyPlan, verify: verify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FlagAgentExecutor = api;
})(typeof window !== 'undefined' ? window : globalThis);
