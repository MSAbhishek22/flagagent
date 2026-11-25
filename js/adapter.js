/* FlagAgent — Flagsmith adapter layer.
   One interface, two implementations:
   - MockAdapter: a local seeded project (see seed.js). Runs the whole
     product with no key. Always labelled MOCK.
   - RealAdapter: the Flagsmith Management REST API
     (https://api.flagsmith.com/api/v1/, header "Authorization: Api-Key <key>").
     The key comes from config only (settings panel / window.FLAGAGENT_CONFIG).
     It is never hardcoded and never written to any log or receipt.

   Interface (all methods return Promises):
     describe()                       -> { mode, projectName }
     listEnvironments()               -> [{ id, name }]
     listSegments()                   -> [{ id, name, description }]
     listFeatures(envId)              -> [{ id, name, type, description, state }]
     getFeatureState(envId, name)     -> state | null
     snapshot()                       -> { environments, segments, featuresByEnv }
     applyChange(change)              -> { ok, detail }   (one change only)
   State shape: { enabled, rollout, value, variants|null, segmentOverrides[] }
*/
(function (global) {
  'use strict';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ---------------- Mock adapter ---------------- */

  function MockAdapter(seed) {
    this.mode = 'MOCK';
    this.project = clone(seed);
  }
  MockAdapter.prototype.describe = function () {
    return Promise.resolve({ mode: 'MOCK', projectName: this.project.projectName });
  };
  MockAdapter.prototype.listEnvironments = function () {
    return Promise.resolve(clone(this.project.environments));
  };
  MockAdapter.prototype.listSegments = function () {
    return Promise.resolve(clone(this.project.segments));
  };
  MockAdapter.prototype._feature = function (name) {
    for (var i = 0; i < this.project.features.length; i++) {
      if (this.project.features[i].name === name) return this.project.features[i];
    }
    return null;
  };
  MockAdapter.prototype.listFeatures = function (envId) {
    var self = this;
    return Promise.resolve(this.project.features.map(function (f) {
      return { id: f.id, name: f.name, type: f.type, description: f.description,
               state: clone(f.states[envId]) };
    }));
  };
  MockAdapter.prototype.getFeatureState = function (envId, name) {
    var f = this._feature(name);
    if (!f) return Promise.resolve(null);
    return Promise.resolve(clone(f.states[envId]));
  };
  MockAdapter.prototype.snapshot = function () {
    var self = this;
    var byEnv = {};
    return this.listEnvironments().then(function (envs) {
      var chain = Promise.resolve();
      envs.forEach(function (env) {
        chain = chain.then(function () {
          return self.listFeatures(env.id).then(function (feats) { byEnv[env.id] = feats; });
        });
      });
      return chain.then(function () {
        return { environments: envs, segments: self.project.segments, featuresByEnv: byEnv };
      });
    });
  };
  MockAdapter.prototype.applyChange = function (change) {
    var f = this._feature(change.feature);
    var envIds = this.project.environments.map(function (e) { return e.id; });

    if (change.kind === 'create_feature') {
      if (f) return Promise.resolve({ ok: false, detail: 'A flag named ' + change.feature + ' already exists.' });
      var nf = { id: 'feat-' + change.feature, name: change.feature,
                 type: change.after.variants ? 'multivariate' : 'bool',
                 description: change.after.description || '', states: {} };
      envIds.forEach(function (envId) {
        nf.states[envId] = { enabled: false, rollout: 0, value: null,
                             variants: change.after.variants ? clone(change.after.variants) : null,
                             segmentOverrides: [] };
      });
      this.project.features.push(nf);
      return Promise.resolve({ ok: true, detail: 'Flag ' + change.feature + ' created.' });
    }

    if (!f) return Promise.resolve({ ok: false, detail: 'No flag named ' + change.feature + ' in this project.' });
    var st = f.states[change.envId];
    if (!st) return Promise.resolve({ ok: false, detail: 'Unknown environment for ' + change.feature + '.' });

    switch (change.kind) {
      case 'delete_feature':
        this.project.features = this.project.features.filter(function (x) { return x.name !== change.feature; });
        return Promise.resolve({ ok: true, detail: 'Flag ' + change.feature + ' deleted.' });
      case 'set_enabled':
        // enabled and rollout are separate fields, as in Flagsmith:
        // turning a flag off keeps its rollout setting for when it returns.
        st.enabled = change.after.enabled;
        return Promise.resolve({ ok: true, detail: change.feature + ' is now ' + (st.enabled ? 'ON' : 'OFF') + '.' });
      case 'set_rollout':
        st.rollout = change.after.rollout;
        return Promise.resolve({ ok: true, detail: change.feature + ' rollout is now ' + st.rollout + '%.' });
      case 'set_value':
        st.value = change.after.value;
        return Promise.resolve({ ok: true, detail: change.feature + ' value set.' });
      case 'set_variants':
        st.variants = clone(change.after.variants);
        f.type = 'multivariate';
        return Promise.resolve({ ok: true, detail: change.feature + ' variants updated.' });
      case 'set_segment_override': {
        var kept = st.segmentOverrides.filter(function (o) { return o.segment !== change.after.segment; });
        kept.push({ segment: change.after.segment, enabled: change.after.enabled,
                    value: change.after.value != null ? change.after.value : null });
        st.segmentOverrides = kept;
        return Promise.resolve({ ok: true, detail: change.feature + ' override set for ' + change.after.segment + '.' });
      }
      default:
        return Promise.resolve({ ok: false, detail: 'Unknown change kind: ' + change.kind });
    }
  };

  /* ---------------- Real Flagsmith adapter ----------------
     Written against the documented Management API (prep pack §2.4) and
     re-checked field-by-field against the live swagger
     (api.flagsmith.com/api/v1/swagger.json) on 25–26 Nov 2026. The
     write-shape facts that bit in the first live run are recorded in
     KEY_HOOKUP.md: the featurestates PUT requires `feature`, a v1
     feature state has no percentage field, and value writes go through
     /features/featurestates/ with a nested feature_state_value. */

  function RealAdapter(config) {
    this.mode = 'LIVE';
    this.base = (config.apiBase || 'https://api.flagsmith.com/api/v1').replace(/\/$/, '');
    this.projectId = config.projectId;
    this.projectName = config.projectName || ('Flagsmith project ' + config.projectId);
    this._key = config.apiKey || ''; // memory only; never logged, never returned
    this._envCache = null;
    this._envKeys = {}; // envId -> environment api_key, learned by listEnvironments; memory only, never returned
    this._stateIds = {}; // "envId:featureName" -> feature state id, learned on read
    this._rawStates = {}; // "envId:featureName" -> raw feature state object, learned on read;
                          // write bodies are built from it so required fields survive the PUT
  }
  RealAdapter.prototype._fetch = function (path, options) {
    var self = this;
    options = options || {};
    options.headers = Object.assign({}, options.headers || {}, {
      'Authorization': 'Api-Key ' + self._key,
      'Content-Type': 'application/json'
    });
    return fetch(self.base + path, options).then(function (res) {
      if (!res.ok) throw new Error('Flagsmith API ' + res.status + ' on ' + path);
      return res.status === 204 ? null : res.json();
    });
  };
  RealAdapter.prototype.describe = function () {
    return Promise.resolve({ mode: 'LIVE', projectName: this.projectName });
  };
  RealAdapter.prototype.listEnvironments = function () {
    var self = this;
    if (this._envCache) return Promise.resolve(clone(this._envCache));
    return this._fetch('/projects/' + this.projectId + '/environments/').then(function (data) {
      var list = (data.results || data || []).map(function (e) {
        // The featurestates endpoints address an environment by its
        // api_key, not its numeric id (see _envApiKey), so keep the key
        // alongside the id — inside the adapter only, never in the
        // returned list.
        if (e.api_key) self._envKeys[String(e.id)] = e.api_key;
        return { id: String(e.id), name: e.name };
      });
      self._envCache = list;
      return clone(list);
    });
  };
  RealAdapter.prototype._envApiKey = function (envId) {
    // The Management API has no /environments/{numeric id}/featurestates/
    // route (verified against the live swagger, 25 Nov 2026): the list and
    // write paths are /environments/{environment_api_key}/featurestates/.
    // Addressing them by numeric id makes the API answer 403.
    var self = this;
    if (this._envKeys[envId]) return Promise.resolve(this._envKeys[envId]);
    return this.listEnvironments().then(function () {
      if (self._envKeys[envId]) return self._envKeys[envId];
      throw new Error('Flagsmith returned no api_key for environment ' + envId + '; cannot read its feature states.');
    });
  };
  RealAdapter.prototype.listSegments = function () {
    return this._fetch('/projects/' + this.projectId + '/segments/').then(function (data) {
      return (data.results || data || []).map(function (s) {
        return { id: String(s.id), name: s.name, description: s.description || '' };
      });
    });
  };
  RealAdapter.prototype._normaliseState = function (fs) {
    if (!fs) return { enabled: false, rollout: 0, value: null, variants: null, segmentOverrides: [] };
    var variants = null;
    if (Array.isArray(fs.multivariate_feature_state_values) && fs.multivariate_feature_state_values.length) {
      variants = fs.multivariate_feature_state_values.map(function (v) {
        return { key: v.multivariate_feature_option_key || v.key || '',
                 value: v.multivariate_feature_option_value != null ? v.multivariate_feature_option_value : v.value,
                 weight: v.percentage_allocation };
      });
    }
    return {
      enabled: !!fs.enabled,
      // CONFIRMED (live swagger, 26 Nov 2026): a v1 feature state has no
      // percentage field at all — rollout % exists only as
      // percentage_allocation on multivariate values. For a standard flag
      // the rollout is therefore derived: enabled -> 100, disabled -> 0.
      rollout: typeof fs.percentage === 'number' ? fs.percentage : (fs.enabled ? 100 : 0),
      value: fs.feature_state_value != null ? fs.feature_state_value : null,
      variants: variants,
      segmentOverrides: []
    };
  };
  RealAdapter.prototype.listFeatures = function (envId) {
    var self = this;
    return this._envApiKey(envId).then(function (envKey) {
      return Promise.all([
        self._fetch('/projects/' + self.projectId + '/features/'),
        self._fetch('/environments/' + envKey + '/featurestates/')
      ]);
    }).then(function (pair) {
      var feats = pair[0].results || pair[0] || [];
      var states = pair[1].results || pair[1] || [];
      var byFeature = {};
      states.forEach(function (fs) {
        byFeature[fs.feature] = fs;
        var fname = null;
        feats.forEach(function (f) { if (f.id === fs.feature) fname = f.name; });
        if (fname) {
          self._stateIds[envId + ':' + fname] = fs.id;
          self._rawStates[envId + ':' + fname] = clone(fs);
        }
      });
      return feats.map(function (f) {
        return { id: String(f.id), name: f.name,
                 type: f.type === 'MULTIVARIATE' || (byFeature[f.id] && byFeature[f.id].multivariate_feature_state_values && byFeature[f.id].multivariate_feature_state_values.length) ? 'multivariate' : (f.type === 'CONFIG' ? 'string' : 'bool'),
                 description: f.description || '',
                 state: self._normaliseState(byFeature[f.id]) };
      });
    });
  };
  RealAdapter.prototype.getFeatureState = function (envId, name) {
    return this.listFeatures(envId).then(function (feats) {
      for (var i = 0; i < feats.length; i++) if (feats[i].name === name) return feats[i].state;
      return null;
    });
  };
  RealAdapter.prototype.snapshot = function () {
    var self = this;
    return Promise.all([this.listEnvironments(), this.listSegments()]).then(function (pair) {
      var byEnv = {};
      var chain = Promise.resolve();
      pair[0].forEach(function (env) {
        chain = chain.then(function () {
          return self.listFeatures(env.id).then(function (feats) { byEnv[env.id] = feats; });
        });
      });
      return chain.then(function () {
        return { environments: pair[0], segments: pair[1], featuresByEnv: byEnv };
      });
    });
  };
  /* Write bodies are built from the raw feature state the read path
     fetched, projected onto the writable fields of the target
     serializer — never assembled from the change alone. The first live
     run (25 Nov 2026) sent only {enabled: ...} and every write came
     back 400: FeatureStateSerializerBasic REQUIRES `feature`, which
     the change-only body never carried. Two routes, per the swagger:
       - PUT /environments/{env api_key}/featurestates/{id}/
         (FeatureStateSerializerBasic) — enabled and multivariate
         weights; its feature_state_value is read-only there.
       - PUT /features/featurestates/{id}/
         (WritableNestedFeatureState) — the value lives here, as a
         nested {type, string_value, integer_value, boolean_value}. */
  RealAdapter.prototype._mvBody = function (raw) {
    var vals = raw.multivariate_feature_state_values;
    if (!Array.isArray(vals) || !vals.length) return null;
    var out = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (v.multivariate_feature_option == null || v.percentage_allocation == null) return null;
      var item = { multivariate_feature_option: v.multivariate_feature_option,
                   percentage_allocation: v.percentage_allocation };
      if (v.id != null) item.id = v.id;
      out.push(item);
    }
    return out;
  };
  RealAdapter.prototype._projectedBody = function (raw) {
    // The writable, non-value fields shared by both write serializers.
    var body = { feature: raw.feature, enabled: !!raw.enabled };
    if (raw.environment != null) body.environment = raw.environment;
    if (raw.identity != null) body.identity = raw.identity;
    if (raw.feature_segment != null) body.feature_segment = raw.feature_segment;
    if (raw.change_request != null) body.change_request = raw.change_request;
    if (raw.environment_feature_version != null) body.environment_feature_version = raw.environment_feature_version;
    if (raw.live_from != null) body.live_from = raw.live_from;
    if (raw.identifier) body.identifier = raw.identifier;
    var mv = this._mvBody(raw);
    if (mv) body.multivariate_feature_state_values = mv;
    return body;
  };
  RealAdapter.prototype._valueObject = function (value) {
    // FeatureStateValue (swagger): type is one of int / unicode / bool,
    // with the matching typed slot filled and the others null.
    if (typeof value === 'boolean') return { type: 'bool', boolean_value: value, string_value: null, integer_value: null };
    if (typeof value === 'number' && isFinite(value)) return { type: 'int', integer_value: Math.trunc(value), string_value: null, boolean_value: null };
    if (value == null) return { type: 'unicode', string_value: null, integer_value: null, boolean_value: null };
    return { type: 'unicode', string_value: String(value), integer_value: null, boolean_value: null };
  };
  RealAdapter.prototype.applyChange = function (change) {
    var self = this;
    if (change.kind === 'create_feature') {
      return this._fetch('/projects/' + this.projectId + '/features/', {
        method: 'POST',
        body: JSON.stringify({ name: change.feature, description: change.after.description || '',
                               type: change.after.variants ? 'MULTIVARIATE' : 'STANDARD' })
      }).then(function () { return { ok: true, detail: 'Flag ' + change.feature + ' created.' }; })
        .catch(function (e) { return { ok: false, detail: e.message }; });
    }
    var key = change.envId + ':' + change.feature;
    var sid = this._stateIds[key];
    var raw = this._rawStates[key];
    if (!sid || !raw) return Promise.resolve({ ok: false, detail: 'Feature state for ' + change.feature + ' was not learned on read; refresh the board and retry.' });
    switch (change.kind) {
      case 'set_enabled': {
        var enabledBody = this._projectedBody(raw);
        enabledBody.enabled = !!change.after.enabled;
        return this._envApiKey(change.envId).then(function (envKey) {
          return self._fetch('/environments/' + envKey + '/featurestates/' + sid + '/', {
            method: 'PUT', body: JSON.stringify(enabledBody)
          });
        }).then(function () { return { ok: true, detail: change.feature + ' is now ' + (enabledBody.enabled ? 'ON' : 'OFF') + '.' }; })
          .catch(function (e) { return { ok: false, detail: e.message }; });
      }
      case 'set_rollout': {
        var rollout = change.after.rollout;
        if (rollout !== 0 && rollout !== 100) {
          // A v1 feature state has no percentage field (live swagger,
          // 26 Nov 2026): a partial rollout exists only as per-variant
          // percentage_allocation on a multivariate flag. Refuse plainly
          // rather than send a field the API does not have.
          return Promise.resolve({ ok: false, detail: 'A ' + rollout + '% rollout cannot be written through the v1 API: feature states have no percentage field (rollout % lives only in multivariate variant weights). Turn the flag fully on or off, or plan a variant change.' });
        }
        var rolloutBody = this._projectedBody(raw);
        rolloutBody.enabled = rollout === 100;
        return this._envApiKey(change.envId).then(function (envKey) {
          return self._fetch('/environments/' + envKey + '/featurestates/' + sid + '/', {
            method: 'PUT', body: JSON.stringify(rolloutBody)
          });
        }).then(function () { return { ok: true, detail: change.feature + ' rollout is now ' + rollout + '%.' }; })
          .catch(function (e) { return { ok: false, detail: e.message }; });
      }
      case 'set_value': {
        var valueBody = this._projectedBody(raw);
        if (valueBody.environment == null) valueBody.environment = parseInt(change.envId, 10);
        valueBody.feature_state_value = this._valueObject(change.after.value);
        return this._fetch('/features/featurestates/' + sid + '/', {
          method: 'PUT', body: JSON.stringify(valueBody)
        }).then(function () { return { ok: true, detail: change.feature + ' value set.' }; })
          .catch(function (e) { return { ok: false, detail: e.message }; });
      }
      default:
        return Promise.resolve({ ok: false, detail: 'Change kind ' + change.kind + ' is not wired for the live API yet; see KEY_HOOKUP.md.' });
    }
  };

  function createAdapter(config, seed) {
    if (config && config.mode === 'LIVE' && config.apiKey && config.projectId) {
      return new RealAdapter(config);
    }
    return new MockAdapter(seed);
  }

  var api = { MockAdapter: MockAdapter, RealAdapter: RealAdapter, createAdapter: createAdapter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FlagAgentAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
