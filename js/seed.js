/* FlagAgent — seed data for the LOCAL MOCK Flagsmith project.
   This is a stand-in project so the whole product runs before the real
   Flagsmith Org API key lands. It is labelled MOCK everywhere it surfaces.
   Shape mirrors the Flagsmith model: Project → Environments → Features,
   each feature holding a per-environment state. */
(function (global) {
  'use strict';

  function boolState(enabled, rollout) {
    return { enabled: enabled, rollout: rollout, value: null, variants: null, segmentOverrides: [] };
  }

  function buildSeedProject() {
    return {
      projectName: 'ChaiKart — storefront (demo project)',
      environments: [
        { id: 'env-dev', name: 'Development' },
        { id: 'env-staging', name: 'Staging' },
        { id: 'env-prod', name: 'Production' }
      ],
      segments: [
        { id: 'seg-beta', name: 'beta_users', description: 'Beta testers who opted in' },
        { id: 'seg-india', name: 'india_users', description: 'Users located in India' },
        { id: 'seg-staff', name: 'staff', description: 'ChaiKart staff accounts' }
      ],
      features: [
        {
          id: 'feat-checkout', name: 'new_checkout', type: 'bool',
          description: 'The new one-page checkout.',
          states: {
            'env-dev': boolState(true, 100),
            'env-staging': boolState(true, 100),
            'env-prod': boolState(false, 0)
          }
        },
        {
          id: 'feat-kill', name: 'payments_kill_switch', type: 'bool',
          description: 'When ON, all payments stop. Kept OFF in normal running.',
          states: {
            'env-dev': boolState(false, 0),
            'env-staging': boolState(false, 0),
            'env-prod': boolState(false, 0)
          }
        },
        {
          id: 'feat-search', name: 'search_v2', type: 'bool',
          description: 'New search ranking.',
          states: {
            'env-dev': boolState(true, 100),
            'env-staging': boolState(true, 50),
            'env-prod': boolState(true, 25)
          }
        },
        {
          id: 'feat-headline', name: 'headline_test', type: 'multivariate',
          description: 'Homepage headline experiment.',
          states: {
            'env-dev': { enabled: true, rollout: 100, value: null, segmentOverrides: [],
              variants: [
                { key: 'control', value: 'Fresh chai, delivered weekly', weight: 50 },
                { key: 'headline_b', value: 'Chai that reaches you in 24 hours', weight: 50 }
              ] },
            'env-staging': { enabled: true, rollout: 100, value: null, segmentOverrides: [],
              variants: [
                { key: 'control', value: 'Fresh chai, delivered weekly', weight: 50 },
                { key: 'headline_b', value: 'Chai that reaches you in 24 hours', weight: 50 }
              ] },
            'env-prod': { enabled: true, rollout: 100, value: null, segmentOverrides: [],
              variants: [
                { key: 'control', value: 'Fresh chai, delivered weekly', weight: 50 },
                { key: 'headline_b', value: 'Chai that reaches you in 24 hours', weight: 50 }
              ] }
          }
        },
        {
          id: 'feat-banner', name: 'shipping_banner_text', type: 'string',
          description: 'Remote config: the shipping banner line.',
          states: {
            'env-dev': { enabled: true, rollout: 100, value: 'Free shipping over ₹499', variants: null, segmentOverrides: [] },
            'env-staging': { enabled: true, rollout: 100, value: 'Free shipping over ₹499', variants: null, segmentOverrides: [] },
            'env-prod': { enabled: true, rollout: 100, value: 'Free shipping over ₹499', variants: null, segmentOverrides: [] }
          }
        },
        {
          id: 'feat-legacy', name: 'legacy_search', type: 'bool',
          description: 'The old search. Due to be retired.',
          states: {
            'env-dev': boolState(true, 100),
            'env-staging': boolState(true, 100),
            'env-prod': boolState(true, 100)
          }
        }
      ]
    };
  }

  var api = { buildSeedProject: buildSeedProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FlagAgentSeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
