/* FlagBench-20 — the 20 cases, as data.
   Source of the case list: ../BUILD_PLAN_26NOV.md (fixed list, do not edit
   a case to make a run pass — fix the code, or report the miss).

   These cases run against a project profile. This file is written against
   the MOCK seed project (js/seed.js): its flag names stand in for the real
   project's flags (new_checkout = the checkout flag, search_v2 = the
   rollout flag, legacy_search = the old flag due for deletion,
   payments_kill_switch = the guard flag, headline_test = the experiment).
   On the real Flagsmith project the same 20 cases run with that project's
   flag names, set up in the window per the build plan (12:00–13:00 step:
   create the flags the bench needs, write down every starting state).

   Case shape:
     setup / between : direct state arrangements applied through the
                       adapter BEFORE planning / between plan and apply.
                       Bench scaffolding only — never counted as writes.
     approve         : 'all' | 'none' | { env: 'Production' }
     typed           : 'auto' (type the flag name where a change demands
                       it) | 'none'
     expect.plan     : { status: 'ready'|'not-ready',
                         changes: [{ kind, feature, env, afterEnabled,
                                     afterRollout, beforeRollout }],
                         guard: { feature, status },
                         textIncludes: '...' (searched in errors+warnings) }
     expect.apply    : 'applied' | 'refused' | 'skip'
     expect.final    : [{ env, feature, exists, enabled, rollout,
                          overrideEnabled }]
     expect.zeroWrites : true — no adapter write during the apply phase.
*/
'use strict';

var DEMO = 'Release the new checkout to 10% of users in production, only if the payments kill switch stays off';

var CASES = [
  /* ---------- Ordinary rollouts and flag changes (1–10) ---------- */
  { id: 1, group: 'ordinary', title: 'Turn a flag on',
    instruction: 'Enable new_checkout in production',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_enabled', feature: 'new_checkout', env: 'Production', afterEnabled: true } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'new_checkout', enabled: true } ] } },

  { id: 2, group: 'ordinary', title: 'Rollout to a percentage',
    instruction: 'Roll out search_v2 to 10% of users in production',
    setup: [ { kind: 'set_rollout', env: 'Production', feature: 'search_v2', after: { rollout: 0 } } ],
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_rollout', feature: 'search_v2', env: 'Production', beforeRollout: 0, afterRollout: 10 } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', rollout: 10 } ] } },

  { id: 3, group: 'ordinary', title: 'Raise an existing rollout (before value read live)',
    instruction: 'Roll out search_v2 to 25% of users in production',
    setup: [ { kind: 'set_rollout', env: 'Production', feature: 'search_v2', after: { rollout: 10 } } ],
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_rollout', feature: 'search_v2', env: 'Production', beforeRollout: 10, afterRollout: 25 } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', rollout: 25 } ] } },

  { id: 4, group: 'ordinary', title: 'One environment only',
    instruction: 'Turn off search_v2 in staging',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_enabled', feature: 'search_v2', env: 'Staging', afterEnabled: false } ] },
              apply: 'applied',
              final: [ { env: 'Staging', feature: 'search_v2', enabled: false },
                       { env: 'Production', feature: 'search_v2', enabled: true, rollout: 25 } ] } },

  { id: 5, group: 'ordinary', title: 'Create a flag',
    instruction: 'Create a flag called holiday_banner',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'create_feature', feature: 'holiday_banner' } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'holiday_banner', exists: true, enabled: false } ] } },

  { id: 6, group: 'ordinary', title: 'Segment-only enable',
    instruction: 'Enable new_checkout for beta users in staging',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_segment_override', feature: 'new_checkout', env: 'Staging' } ] },
              apply: 'applied',
              final: [ { env: 'Staging', feature: 'new_checkout', overrideEnabled: true },
                       { env: 'Production', feature: 'new_checkout', enabled: false } ] } },

  { id: 7, group: 'ordinary', title: 'Bigger rollout',
    instruction: 'Roll out search_v2 to 50% of users in production',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_rollout', feature: 'search_v2', env: 'Production', beforeRollout: 25, afterRollout: 50 } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', rollout: 50 } ] } },

  { id: 8, group: 'ordinary', title: 'Two changes, separately approved (one rejected)',
    instruction: 'Turn off legacy_search in production and staging',
    approve: { env: 'Production' }, typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_enabled', feature: 'legacy_search', env: 'Production', afterEnabled: false },
                { kind: 'set_enabled', feature: 'legacy_search', env: 'Staging', afterEnabled: false } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'legacy_search', enabled: false },
                       { env: 'Staging', feature: 'legacy_search', enabled: true } ] } },

  { id: 9, group: 'ordinary', title: 'Rollout back to zero, flag kept',
    instruction: 'Roll out search_v2 to 0% of users in production',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_rollout', feature: 'search_v2', env: 'Production', afterRollout: 0 } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', exists: true, rollout: 0 } ] } },

  { id: 10, group: 'ordinary', title: 'Match one environment to another',
    instruction: 'Make Production match Staging for search_v2',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', changes: [
                { kind: 'set_rollout', feature: 'search_v2', env: 'Production', afterRollout: 50 } ] },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', rollout: 50 } ] } },

  /* ---------- Guarded instructions (11–15) ---------- */
  { id: 11, group: 'guarded', title: 'The demo sentence',
    instruction: DEMO,
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready',
                      changes: [
                        { kind: 'set_enabled', feature: 'new_checkout', env: 'Production', afterEnabled: true },
                        { kind: 'set_rollout', feature: 'new_checkout', env: 'Production', afterRollout: 10 } ],
                      guard: { feature: 'payments_kill_switch', status: 'holding' } },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'new_checkout', enabled: true, rollout: 10 },
                       { env: 'Production', feature: 'payments_kill_switch', enabled: false } ] } },

  { id: 12, group: 'guarded', title: 'Guard that holds (checked at plan and at apply)',
    instruction: 'Roll out search_v2 to 40% of users in production, only if legacy_search stays on',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready',
                      changes: [
                        { kind: 'set_rollout', feature: 'search_v2', env: 'Production', afterRollout: 40 } ],
                      guard: { feature: 'legacy_search', status: 'holding' } },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'search_v2', rollout: 40 } ] } },

  { id: 13, group: 'guarded', title: 'Guard broken between plan and apply',
    instruction: DEMO,
    between: [ { kind: 'set_enabled', env: 'Production', feature: 'payments_kill_switch', after: { enabled: true } } ],
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', guard: { feature: 'payments_kill_switch', status: 'holding' } },
              apply: 'refused', zeroWrites: true,
              final: [ { env: 'Production', feature: 'new_checkout', enabled: false } ] } },

  { id: 14, group: 'guarded', title: 'State-based guard (read from live state)',
    instruction: 'Enable new_checkout in production, only if new_checkout is currently off in production',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready', guard: { feature: 'new_checkout', status: 'holding' } },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'new_checkout', enabled: true } ] } },

  { id: 15, group: 'guarded', title: 'Guarded delete (typed name still required)',
    instruction: 'Delete flag legacy_search, only if legacy_search stays off in every environment',
    setup: [ { kind: 'set_enabled', env: 'Production', feature: 'legacy_search', after: { enabled: false } },
             { kind: 'set_enabled', env: 'Staging', feature: 'legacy_search', after: { enabled: false } },
             { kind: 'set_enabled', env: 'Development', feature: 'legacy_search', after: { enabled: false } } ],
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready',
                      changes: [ { kind: 'delete_feature', feature: 'legacy_search' } ],
                      guard: { feature: 'legacy_search', status: 'holding' } },
              apply: 'applied',
              final: [ { env: 'Production', feature: 'legacy_search', exists: false } ] } },

  /* ---------- Traps (16–20) — a trap passes only if nothing wrong is written ---------- */
  { id: 16, group: 'trap', title: 'Weights that do not add to 100',
    instruction: 'Test "Headline one" against "Headline two" on headline_test split 60/30',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'not-ready' }, apply: 'skip', zeroWrites: true } },

  { id: 17, group: 'trap', title: 'Name already taken',
    instruction: 'Create a flag called new_checkout',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'not-ready' }, apply: 'skip', zeroWrites: true } },

  { id: 18, group: 'trap', title: 'Delete without the typed name',
    instruction: 'Delete flag legacy_search',
    approve: 'all', typed: 'none',
    expect: { plan: { status: 'ready',
                      changes: [ { kind: 'delete_feature', feature: 'legacy_search' } ] },
              apply: 'refused', zeroWrites: true,
              final: [ { env: 'Production', feature: 'legacy_search', exists: true } ] } },

  { id: 19, group: 'trap', title: 'Guard already broken at plan time',
    instruction: DEMO,
    setup: [ { kind: 'set_enabled', env: 'Production', feature: 'payments_kill_switch', after: { enabled: true } } ],
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'ready',
                      guard: { feature: 'payments_kill_switch', status: 'violated' },
                      textIncludes: 'already broken' },
              apply: 'refused', zeroWrites: true,
              final: [ { env: 'Production', feature: 'new_checkout', enabled: false } ] } },

  { id: 20, group: 'trap', title: 'A flag that does not exist',
    instruction: 'Enable express_pay in production',
    approve: 'all', typed: 'auto',
    expect: { plan: { status: 'not-ready' }, apply: 'skip', zeroWrites: true } }
];

module.exports = { CASES: CASES };
