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

    /* ---- plain enable / disable ---- */
    if (wantsDisable && !wantsEnable) {
      if (!st.enabled) { plan.warnings.push(feature.name + ' is already OFF in ' + env.name + '.'); return finish(plan); }
      plan.changes.push(change('set_enabled', env, feature.name, { enabled: true }, { enabled: false },
        env.name + ' · ' + feature.name + ': ON (' + st.rollout + '%) → OFF',
        env.name === 'Production' && st.rollout > 0 ? { caution: true } : null));
      if (env.name === 'Production' && st.rollout > 0) plan.warnings.push('This turns off a flag that is live for ' + st.rollout + '% of users in Production.');
      return finish(plan);
    }
    if (wantsEnable) {
      if (st.enabled && st.rollout === 100) { plan.warnings.push(feature.name + ' is already fully ON in ' + env.name + '.'); return finish(plan); }
      if (!st.enabled) plan.changes.push(change('set_enabled', env, feature.name, { enabled: false }, { enabled: true },
        env.name + ' · ' + feature.name + ': OFF → ON'));
      if (st.rollout !== 100) plan.changes.push(change('set_rollout', env, feature.name, { rollout: st.rollout }, { rollout: 100 },
        env.name + ' · ' + feature.name + ': rollout ' + st.rollout + '% → 100%'));
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
