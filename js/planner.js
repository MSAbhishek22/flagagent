/* FlagAgent — the planner.
   Turns one plain-language instruction into a staged plan of flag changes.
   Deterministic on purpose (prep pack R6): no model call, so every plan is
   reproducible and testable. Planning reads state only — it never writes.

   parseInstruction(text, snapshot) -> plan
   plan = { instruction, envId, envName, changes[], guards[], assumptions[],
            errors[], warnings[], status, hash }
   status: 'ready' | 'blocked' | 'needs_clarification'
   change = { id, kind, envId, envName, feature, before, after, text,
              caution, requiresTypedConfirm }
*/
(function (global) {
  'use strict';

  function spaced(name) { return name.replace(/_/g, ' '); }

  function findFeature(text, features) {
    var lower = ' ' + text.toLowerCase() + ' ';
    var best = null;
    features.forEach(function (f) {
      [f.name.toLowerCase(), spaced(f.name)].forEach(function (cand) {
        if (cand.length >= 3 && lower.indexOf(' ' + cand + ' ') !== -1 || lower.indexOf(' ' + cand + ',') !== -1 || lower.indexOf(' ' + cand + '.') !== -1) {
          if (!best || cand.length > best.matched.length) best = { feature: f, matched: cand };
        }
      });
    });
    return best;
  }

  function findEnv(text, snapshot, assumptions) {
    var lower = text.toLowerCase();
    var hit = null;
    snapshot.environments.forEach(function (env) {
      var n = env.name.toLowerCase();
      if (lower.indexOf('in ' + n) !== -1 || lower.indexOf('on ' + n) !== -1) hit = env;
      if (n === 'production' && /\bprod\b/.test(lower)) hit = env;
      if (n === 'development' && /\bdev\b/.test(lower)) hit = env;
    });
    if (!hit) {
      hit = snapshot.environments.filter(function (e) { return e.name === 'Production'; })[0] || snapshot.environments[0];
      assumptions.push('No environment was named, so this plan targets ' + hit.name + '. Say "in Staging" or "in Development" to change it.');
    }
    return hit;
  }

  function findSegment(text, snapshot) {
    var lower = text.toLowerCase();
    var hit = null;
    snapshot.segments.forEach(function (s) {
      if (lower.indexOf(spaced(s.name)) !== -1 || lower.indexOf(s.name.toLowerCase()) !== -1) hit = s;
    });
    return hit;
  }

  /* Every environment the instruction names outright ("in production",
     "and staging", "prod"), in the order named. findEnv picks one target;
     this list is what lets a plain on/off instruction plan the same change
     in each named environment instead of silently dropping all but one. */
  function findNamedEnvs(text, snapshot) {
    var lower = text.toLowerCase();
    var hits = [];
    snapshot.environments.forEach(function (env) {
      var n = env.name.toLowerCase();
      var idx = -1;
      ['in ' + n, 'on ' + n, 'and ' + n].forEach(function (p) {
        var i = lower.indexOf(p);
        if (i !== -1 && (idx === -1 || i < idx)) idx = i;
      });
      if (n === 'production') { var mp = lower.search(/\bprod\b/); if (mp !== -1 && (idx === -1 || mp < idx)) idx = mp; }
      if (n === 'development') { var md = lower.search(/\bdev\b/); if (md !== -1 && (idx === -1 || md < idx)) idx = md; }
      if (idx !== -1) hits.push({ env: env, idx: idx });
    });
    hits.sort(function (a, b) { return a.idx - b.idx; });
    return hits.map(function (h) { return h.env; });
  }

  function envByWord(word, snapshot) {
    var w = String(word || '').toLowerCase();
    var hit = null;
    snapshot.environments.forEach(function (env) {
      if (env.name.toLowerCase() === w) hit = env;
      if (w === 'prod' && env.name === 'Production') hit = env;
      if (w === 'dev' && env.name === 'Development') hit = env;
    });
    return hit;
  }

  function stateInEnv(snapshot, envId, featureName) {
    var list = snapshot.featuresByEnv[envId] || [];
    var found = null;
    list.forEach(function (f) { if (f.name === featureName) found = f.state; });
    return found;
  }

  function splitGuard(text) {
    var m = text.match(/^(.*?)[,;]?\s+(only if|as long as|provided that|unless)\s+(.+)$/i);
    if (!m) return { main: text, guardText: null, guardJoin: null };
    return { main: m[1].trim(), guardText: m[3].trim(), guardJoin: m[2].toLowerCase() };
  }

  function parseGuard(guardText, join, features, envId, snapshot) {
    if (!guardText) return null;
    var hit = findFeature(guardText, features);
    var lower = guardText.toLowerCase();
    var mustBe = null;
    if (join === 'unless') {
      if (/\b(on|enabled|active)\b/.test(lower)) mustBe = 'off';
      else if (/\b(off|disabled)\b/.test(lower)) mustBe = 'on';
    } else {
      if (/\b(off|disabled|down)\b/.test(lower) || /stays?\s+off/.test(lower) || /remains?\s+off/.test(lower)) mustBe = 'off';
      else if (/\b(on|enabled|active)\b/.test(lower)) mustBe = 'on';
    }
    if (!hit || !mustBe) {
      return { feature: hit ? hit.feature.name : null, mustBe: mustBe, text: guardText,
               status: 'unknown' };
    }
    var feats = snapshot.featuresByEnv[envId] || [];
    var cur = null;
    feats.forEach(function (f) { if (f.name === hit.feature.name) cur = f.state; });
    var status = 'unknown';
    if (cur) status = (mustBe === 'off') ? (cur.enabled ? 'violated' : 'holding')
                                         : (cur.enabled ? 'holding' : 'violated');
    return { feature: hit.feature.name, mustBe: mustBe, text: guardText, status: status };
  }

  function onOff(b) { return b ? 'ON' : 'OFF'; }

  function planHash(changes) {
    var canon = JSON.stringify(changes.map(function (c) {
      return [c.kind, c.feature, c.envId, JSON.stringify(c.after)];
    }));
    var h = 5381;
    for (var i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  var seq = 0;
  function change(kind, env, feature, before, after, text, extra) {
    var c = { id: 'c' + (++seq), kind: kind, envId: env.id, envName: env.name,
              feature: feature, before: before, after: after, text: text,
              caution: false, requiresTypedConfirm: null };
    if (extra) Object.assign(c, extra);
    return c;
  }

  function parseInstruction(rawText, snapshot) {
    var plan = { instruction: rawText, envId: null, envName: null, changes: [],
                 guards: [], assumptions: [], errors: [], warnings: [],
                 status: 'ready', hash: null };
    var text = (rawText || '').trim();
    if (!text) { plan.status = 'needs_clarification'; plan.errors.push('The instruction is empty.'); return plan; }

    var allFeatures = [];
    var seen = {};
    Object.keys(snapshot.featuresByEnv).forEach(function (envId) {
      snapshot.featuresByEnv[envId].forEach(function (f) {
        if (!seen[f.name]) { seen[f.name] = true; allFeatures.push(f); }
      });
    });

    var env = findEnv(text, snapshot, plan.assumptions);
    plan.envId = env.id; plan.envName = env.name;
    var envFeatures = snapshot.featuresByEnv[env.id] || [];

    var parts = splitGuard(text);
    var guard = parseGuard(parts.guardText, parts.guardJoin, allFeatures, env.id, snapshot);
    if (guard) {
      plan.guards.push(guard);
      if (guard.status === 'unknown') plan.warnings.push('The guard condition could not be matched to a flag state, so it cannot be checked automatically: "' + guard.text + '".');
      if (guard.status === 'violated') plan.warnings.push('The guard is already broken: ' + guard.feature + ' is not ' + guard.mustBe.toUpperCase() + ' in ' + env.name + '. Applying is refused until it holds again.');
    }
    var main = parts.main;
    var lower = main.toLowerCase();

    var segment = findSegment(main, snapshot);

    /* ---- delete (destructive) ---- */
    if (/\b(delete|remove)\b/.test(lower) && /\bflag\b/.test(lower) || /^\s*(delete|remove)\s+/.test(lower)) {
      var df = findFeature(main, envFeatures);
      if (!df) { plan.status = 'blocked'; plan.errors.push('Delete was asked for, but no matching flag was found in ' + env.name + '. Nothing was planned.'); return finish(plan); }
      plan.changes.push(change('delete_feature', env, df.feature.name,
        { exists: true }, { exists: false },
        env.name + ' · ' + df.feature.name + ': flag exists → deleted everywhere',
        { caution: true, requiresTypedConfirm: df.feature.name }));
      plan.warnings.push('Deleting a flag cannot be undone here. The apply step will ask you to type the flag name.');
      return finish(plan);
    }

    /* ---- create ---- */
    var createMatch = main.match(/create\s+(?:a\s+)?(?:new\s+)?flag\s+(?:called\s+|named\s+)?["'`]?([a-z0-9_][a-z0-9_ ]*?)["'`]?(?:\s+with\b|\s+in\b|$)/i);
    if (/\bcreate\b/.test(lower) && /\bflag\b/.test(lower) && createMatch) {
      var newName = createMatch[1].trim().replace(/\s+/g, '_').toLowerCase();
      var exists = allFeatures.some(function (f) { return f.name === newName; });
      if (exists) { plan.status = 'blocked'; plan.errors.push('A flag named ' + newName + ' already exists. Pick another name.'); return finish(plan); }
      var variants = parseVariants(main, null, plan);
      var after = { description: '', variants: variants };
      plan.changes.push(change('create_feature', env, newName, null, after,
        'New flag · ' + newName + (variants ? ': multivariate with ' + variants.map(function (v) { return v.key + ' ' + v.weight + '%'; }).join(' / ') : ': boolean, starts OFF in every environment')));
      return finish(plan);
    }

    /* ---- everything below needs an existing flag ---- */
    var hit = findFeature(main, envFeatures);
    if (!hit) {
      plan.status = 'needs_clarification';
      plan.errors.push('No flag in ' + env.name + ' matches that instruction. Name the flag exactly, for example "new_checkout". Known flags: ' + envFeatures.map(function (f) { return f.name; }).join(', ') + '.');
      return finish(plan);
    }
    var feature = hit.feature;
    var st = feature.state;

    /* ---- match one environment to another ----
       "Make Production match Staging for <flag>": the plan is the diff —
       one tickable change per state field that differs, so after applying,
       the target environment's state for this flag equals the source's.
       Guards parsed above still apply, and the executor re-checks them at
       apply time against the target environment. */
    var matchM = main.match(/\bmake\s+([a-z]+)\s+match\s+([a-z]+)\b/i);
    if (matchM) {
      var targetEnv = envByWord(matchM[1], snapshot);
      var sourceEnv = envByWord(matchM[2], snapshot);
      if (!targetEnv || !sourceEnv || targetEnv.id === sourceEnv.id) {
        plan.status = 'needs_clarification';
        plan.errors.push('Matching needs two different environments, named plainly: "Make Production match Staging for ' + feature.name + '".');
        return finish(plan);
      }
      plan.assumptions = plan.assumptions.filter(function (a) { return a.indexOf('No environment was named') !== 0; });
      plan.envId = targetEnv.id; plan.envName = targetEnv.name;
      var tgtState = stateInEnv(snapshot, targetEnv.id, feature.name);
      var srcState = stateInEnv(snapshot, sourceEnv.id, feature.name);
      if (!tgtState || !srcState) {
        plan.status = 'blocked';
        plan.errors.push(feature.name + ' is not present in both ' + targetEnv.name + ' and ' + sourceEnv.name + ', so there is nothing to match.');
        return finish(plan);
      }
      if (plan.guards.length && plan.guards[0].feature && plan.guards[0].mustBe) {
        var gState = stateInEnv(snapshot, targetEnv.id, plan.guards[0].feature);
        if (gState) plan.guards[0].status = plan.guards[0].mustBe === 'off'
          ? (gState.enabled ? 'violated' : 'holding')
          : (gState.enabled ? 'holding' : 'violated');
      }
      if (tgtState.enabled !== srcState.enabled) {
        plan.changes.push(change('set_enabled', targetEnv, feature.name,
          { enabled: tgtState.enabled }, { enabled: srcState.enabled },
          targetEnv.name + ' · ' + feature.name + ': ' + onOff(tgtState.enabled) + ' → ' + onOff(srcState.enabled) + ' (to match ' + sourceEnv.name + ')',
          !srcState.enabled && targetEnv.name === 'Production' && tgtState.rollout > 0 ? { caution: true } : null));
        if (!srcState.enabled && targetEnv.name === 'Production' && tgtState.rollout > 0)
          plan.warnings.push('Matching ' + sourceEnv.name + ' turns off a flag that is live for ' + tgtState.rollout + '% of users in Production.');
      }
      if (tgtState.rollout !== srcState.rollout) {
        plan.changes.push(change('set_rollout', targetEnv, feature.name,
          { rollout: tgtState.rollout }, { rollout: srcState.rollout },
          targetEnv.name + ' · ' + feature.name + ': rollout ' + tgtState.rollout + '% → ' + srcState.rollout + '% (to match ' + sourceEnv.name + ')'));
      }
      if (tgtState.value !== srcState.value) {
        plan.changes.push(change('set_value', targetEnv, feature.name,
          { value: tgtState.value }, { value: srcState.value },
          targetEnv.name + ' · ' + feature.name + ': value ' + JSON.stringify(tgtState.value) + ' → ' + JSON.stringify(srcState.value) + ' (to match ' + sourceEnv.name + ')'));
      }
      if (JSON.stringify(tgtState.variants || null) !== JSON.stringify(srcState.variants || null)) {
        plan.changes.push(change('set_variants', targetEnv, feature.name,
          { variants: tgtState.variants },
          { variants: srcState.variants ? srcState.variants.map(function (v) { return { key: v.key, value: v.value, weight: v.weight }; }) : null },
          targetEnv.name + ' · ' + feature.name + ': variants → the ' + sourceEnv.name + ' set (to match ' + sourceEnv.name + ')'));
      }
      if ((tgtState.segmentOverrides || []).length || (srcState.segmentOverrides || []).length)
        plan.assumptions.push('Segment overrides on ' + feature.name + ' are not copied by matching; only the general state is matched.');
      if (!plan.changes.length) plan.warnings.push(feature.name + ' in ' + targetEnv.name + ' already matches ' + sourceEnv.name + '.');
      return finish(plan);
    }

    var pctMatch = main.match(/(\d{1,3})\s*(?:%|percent)/);
    var pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
    var wantsVariants = /\b(test|experiment|variants?|a\/b)\b/.test(lower) || /\bsplit\s+\d+\s*\/\s*\d+/.test(lower);
    var wantsValue = /\bset\b[^.]*\bto\b/.test(lower) && /["']/.test(main);
    var wantsDisable = /\b(disable|turn off|switch off|deactivate)\b/.test(lower);
    var wantsEnable = /\b(enable|turn on|switch on|activate|release|roll|ship|launch)\b/.test(lower);

    /* ---- variants / experiment ---- */
    if (wantsVariants && !wantsValue) {
      var vars = parseVariants(main, st, plan);
      if (!vars) { plan.status = 'blocked'; plan.errors.push('An experiment needs at least two variants. Name two, for example: test "Fresh chai, delivered weekly" against "Chai in 24 hours" on ' + feature.name + '.'); return finish(plan); }
      var beforeVars = st.variants ? st.variants.map(function (v) { return v.key + ' ' + v.weight + '%'; }).join(' / ') : 'single value';
      plan.changes.push(change('set_variants', env, feature.name,
        { variants: st.variants }, { variants: vars },
        env.name + ' · ' + feature.name + ': variants ' + beforeVars + ' → ' + vars.map(function (v) { return v.key + ' ' + v.weight + '%'; }).join(' / ')));
      if (!st.enabled) plan.changes.push(change('set_enabled', env, feature.name, { enabled: false }, { enabled: true },
        env.name + ' · ' + feature.name + ': OFF → ON'));
      return finish(plan);
    }

    /* ---- remote config value ---- */
    if (wantsValue) {
      var vm = main.match(/["']([^"']+)["']/);
      plan.changes.push(change('set_value', env, feature.name,
        { value: st.value }, { value: vm[1] },
        env.name + ' · ' + feature.name + ': value ' + JSON.stringify(st.value) + ' → ' + JSON.stringify(vm[1])));
      return finish(plan);
    }

    /* ---- rollout percentage ---- */
    if (pct !== null && (wantsEnable || /\b(to|at)\s+\d{1,3}\s*(?:%|percent)/.test(lower))) {
      if (segment) {
        plan.changes.push(change('set_segment_override', env, feature.name,
          { segment: segment.name, enabled: overrideState(st, segment.name) },
          { segment: segment.name, enabled: true, value: null },
          env.name + ' · ' + feature.name + ' for segment ' + segment.name + ': → ON'));
        plan.warnings.push('A percentage inside one segment is not modelled in this build, so the plan turns the flag fully ON for ' + segment.name + ' only. The global state does not change.');
        return finish(plan);
      }
      if (!st.enabled && pct > 0) {
        plan.changes.push(change('set_enabled', env, feature.name, { enabled: false }, { enabled: true },
          env.name + ' · ' + feature.name + ': OFF → ON'));
      }
      if (pct !== st.rollout) {
        plan.changes.push(change('set_rollout', env, feature.name, { rollout: st.rollout }, { rollout: pct },
          env.name + ' · ' + feature.name + ': rollout ' + st.rollout + '% → ' + pct + '%'));
      } else {
        plan.warnings.push(feature.name + ' is already at ' + pct + '% in ' + env.name + ', so there is nothing to change.');
      }
      return finish(plan);
    }

    /* ---- segment-only enable/disable ---- */
    if (segment && (wantsEnable || wantsDisable)) {
      var target = wantsEnable && !wantsDisable;
      plan.changes.push(change('set_segment_override', env, feature.name,
        { segment: segment.name, enabled: overrideState(st, segment.name) },
        { segment: segment.name, enabled: target, value: null },
        env.name + ' · ' + feature.name + ' for segment ' + segment.name + ': → ' + onOff(target)));
      return finish(plan);
    }

    /* ---- plain enable / disable ----
       One flag, one operation — but if the instruction names several
       environments ("turn off X in production and staging"), the change
       is planned in each of them, one tickable change per environment.
       That is not a compound instruction: the documented clarification
       rule covers several flags or operations in one sentence, not one
       flag named for two environments. Dropping the second environment
       silently, as the planner used to, is the one outcome neither the
       rule nor the plan allows. */
    var namedEnvs = findNamedEnvs(main, snapshot);
    var targetEnvs = namedEnvs.length > 1 ? namedEnvs : [env];
    if (wantsDisable && !wantsEnable) {
      targetEnvs.forEach(function (e) {
        var s = stateInEnv(snapshot, e.id, feature.name);
        if (!s) { plan.warnings.push('There is no flag named ' + feature.name + ' in ' + e.name + ', so nothing was planned there.'); return; }
        if (!s.enabled) { plan.warnings.push(feature.name + ' is already OFF in ' + e.name + '.'); return; }
        plan.changes.push(change('set_enabled', e, feature.name, { enabled: true }, { enabled: false },
          e.name + ' · ' + feature.name + ': ON (' + s.rollout + '%) → OFF',
          e.name === 'Production' && s.rollout > 0 ? { caution: true } : null));
        if (e.name === 'Production' && s.rollout > 0) plan.warnings.push('This turns off a flag that is live for ' + s.rollout + '% of users in Production.');
      });
      return finish(plan);
    }
    if (wantsEnable) {
      targetEnvs.forEach(function (e) {
        var s = stateInEnv(snapshot, e.id, feature.name);
        if (!s) { plan.warnings.push('There is no flag named ' + feature.name + ' in ' + e.name + ', so nothing was planned there.'); return; }
        if (s.enabled && s.rollout === 100) { plan.warnings.push(feature.name + ' is already fully ON in ' + e.name + '.'); return; }
        if (!s.enabled) plan.changes.push(change('set_enabled', e, feature.name, { enabled: false }, { enabled: true },
          e.name + ' · ' + feature.name + ': OFF → ON'));
        if (s.rollout !== 100) plan.changes.push(change('set_rollout', e, feature.name, { rollout: s.rollout }, { rollout: 100 },
          e.name + ' · ' + feature.name + ': rollout ' + s.rollout + '% → 100%'));
      });
      return finish(plan);
    }

    plan.status = 'needs_clarification';
    plan.errors.push('That instruction does not match anything FlagAgent can plan. Try: "release ' + feature.name + ' to 10% of users in production", "enable ' + feature.name + ' in staging", or "set ' + feature.name + ' to \\"a new value\\"".');
    return finish(plan);
  }

  function overrideState(state, segmentName) {
    var found = null;
    (state.segmentOverrides || []).forEach(function (o) { if (o.segment === segmentName) found = o.enabled; });
    return found;
  }

  function parseVariants(text, state, plan) {
    var split = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    var weights = split ? [parseInt(split[1], 10), parseInt(split[2], 10)] : [50, 50];
    var quoted = [];
    var re = /["']([^"']+)["']/g, m;
    while ((m = re.exec(text)) !== null) quoted.push(m[1]);
    if (quoted.length >= 2) {
      return [ { key: 'control', value: quoted[0], weight: weights[0] },
               { key: 'variant_b', value: quoted[1], weight: weights[1] } ];
    }
    if (state && state.variants && state.variants.length >= 2) {
      var vs = state.variants.map(function (v, i) {
        return { key: v.key, value: v.value, weight: weights[i] != null ? weights[i] : v.weight };
      });
      if (split) plan.assumptions.push('Existing variants kept; only the split changes to ' + weights.join(' / ') + '.');
      return vs;
    }
    if (/\bcreate\b/i.test(text)) {
      var named = text.match(/variants?\s+([a-z0-9_]+)\s+and\s+([a-z0-9_]+)/i);
      if (named) return [ { key: named[1].toLowerCase(), value: named[1], weight: weights[0] },
                          { key: named[2].toLowerCase(), value: named[2], weight: weights[1] } ];
    }
    return null;
  }

  function validatePlan(plan) {
    plan.changes.forEach(function (c) {
      if (c.kind === 'set_rollout') {
        if (typeof c.after.rollout !== 'number' || c.after.rollout < 0 || c.after.rollout > 100) {
          plan.errors.push('Rollout for ' + c.feature + ' must be between 0% and 100%.');
        }
      }
      if (c.kind === 'set_variants' || (c.kind === 'create_feature' && c.after.variants)) {
        var vs = c.after.variants;
        if (!vs || vs.length < 2) plan.errors.push(c.feature + ' needs at least two variants.');
        else {
          var sum = vs.reduce(function (a, v) { return a + v.weight; }, 0);
          if (sum !== 100) plan.errors.push('Variant weights for ' + c.feature + ' add up to ' + sum + '%, not 100%. Flagsmith will refuse this.');
          vs.forEach(function (v) { if (!v.key) plan.errors.push('Every variant of ' + c.feature + ' needs a key, or it records no exposures.'); });
        }
      }
    });
    if (plan.errors.length && plan.status === 'ready') plan.status = 'blocked';
    return plan;
  }

  function finish(plan) {
    validatePlan(plan);
    plan.hash = planHash(plan.changes);
    if (!plan.changes.length && plan.status === 'ready' && !plan.errors.length) {
      plan.status = 'blocked';
    }
    return plan;
  }

  var api = { parseInstruction: parseInstruction, validatePlan: validatePlan, planHash: planHash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FlagAgentPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
