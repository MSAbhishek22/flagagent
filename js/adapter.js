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
     /features/featurestates/ with a nested feature_state_value.
     Environments with v2 feature versioning (project 54209 is one —
     confirmed live 26 Nov 2026 by the API's own 400: "This environment
     uses v2 feature versioning. Use the environment feature version
     endpoint instead.") reject those legacy writes outright; their
     writes go through the environment feature version endpoints
     (create/reuse a draft version, change the state inside it, publish).
     The environments list carries the upfront signal
     (use_v2_feature_versioning); when it is absent the adapter latches
     onto the version flow from that 400 instead. */

  function RealAdapter(config) {
    this.mode = 'LIVE';
    this.base = (config.apiBase || 'https://api.flagsmith.com/api/v1').replace(/\/$/, '');
    this.projectId = config.projectId;
    this.projectName = config.projectName || ('Flagsmith project ' + config.projectId);
    this._key = config.apiKey || ''; // memory only; never logged, never returned
    this._envCache = null;
    this._envKeys = {}; // envId -> environment api_key, learned by listEnvironments; memory only, never returned
    this._v2Envs = {}; // envId -> true when the environment uses v2 feature versioning
                       // (the environments list flag, or latched from the versioning 400)
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
      if (!res.ok) {
        // Surface the API's own words: a 400 body names the field that
        // failed validation, which a bare status never does (the first
        // live write runs failed blind for exactly this reason). The
        // body is validation text only — request headers and the key
        // are never read into the error. Some fetch stubs have no
        // text(); fall back to the bare status there.
        var read = (typeof res.text === 'function') ? res.text() : Promise.resolve('');
        return read.then(function (text) {
          var body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
          throw new Error('Flagsmith API ' + res.status + ' on ' + path + (body ? ' — ' + body : ''));
        });
      }
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
        // The environment serializers carry use_v2_feature_versioning
        // (live swagger, 26 Nov 2026): the upfront signal that writes
        // for this environment must use the feature version endpoints.
        if (e.use_v2_feature_versioning) self._v2Envs[String(e.id)] = true;
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
         nested {type, string_value, integer_value, boolean_value}.
     On a v2-versioned environment both routes are rejected and the
     write goes through the feature version endpoints instead — see
     _applyChangeV2 below. */
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
  RealAdapter.prototype._intField = function (v) {
    // The write serializers type feature / environment / identity /
    // feature_segment / change_request as integers, but the read shape
    // does not always hand them back as numbers: the featurestates LIST
    // answers with FeatureStateSerializerWithIdentity, whose `identity`
    // is a nested {id, identifier} object where the write serializer
    // wants the integer id or null (live swagger, 26 Nov 2026). Coerce
    // what is safely coercible — an object contributes its numeric id —
    // and drop the rest rather than send a wrong-typed value (a 400).
    if (typeof v === 'number' && isFinite(v)) return Math.trunc(v);
    if (v && typeof v === 'object' && typeof v.id === 'number' && isFinite(v.id)) return Math.trunc(v.id);
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v, 10);
    return undefined;
  };
  RealAdapter.prototype._projectedBody = function (raw) {
    // The writable, non-value fields shared by both write serializers,
    // projected field-by-field onto FeatureStateSerializerBasic /
    // WritableNestedFeatureState (live swagger, 26 Nov 2026; the full
    // field-by-field contract is written out in KEY_HOOKUP.md). The
    // read-only keys (id, uuid, version, created_at, updated_at,
    // deleted_at and, on the environment route, feature_state_value)
    // are never emitted, and neither is any other key a list item
    // happens to carry — only the fields below can appear.
    var body = { feature: raw.feature, enabled: !!raw.enabled };
    var f = this._intField(raw.feature);
    if (f !== undefined) body.feature = f;
    var env = this._intField(raw.environment);
    if (env !== undefined) body.environment = env;
    var ident = this._intField(raw.identity);
    if (ident !== undefined) body.identity = ident;
    var seg = this._intField(raw.feature_segment);
    if (seg !== undefined) body.feature_segment = seg;
    var cr = this._intField(raw.change_request);
    if (cr !== undefined) body.change_request = cr;
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
  /* ---- v2 feature versioning writes ----
     On a v2-versioned environment the legacy featurestates PUT is
     rejected no matter the body (live 400, 26 Nov 2026: "This
     environment uses v2 feature versioning. Use the environment
     feature version endpoint instead."). The version flow, from the
     live swagger (paths are relative to the API base; note the
     versions family addresses the environment by its NUMERIC pk,
     unlike the featurestates routes which use the api_key):
       GET  /environments/{envPk}/features/{featurePk}/versions/
            -> PaginatedEnvironmentFeatureVersionList
       POST /environments/{envPk}/features/{featurePk}/versions/
            body EnvironmentFeatureVersionCreate (all fields optional)
            -> 201, the version (uuid, published, is_live, ...)
       GET  /environments/{envPk}/features/{featurePk}/versions/{uuid}/featurestates/
            -> [CustomEnvironmentFeatureVersionFeatureState]
       POST .../versions/{uuid}/featurestates/            (create a state)
       PUT  .../versions/{uuid}/featurestates/{id}/       (update a state)
            body CustomEnvironmentFeatureVersionFeatureState:
            feature_state_value is REQUIRED there (the nested object);
            writable: enabled, feature_state_value, feature_segment,
            multivariate_feature_state_values; read-only, never sent:
            id, feature, environment, identity, change_request, uuid,
            live_from, created_at, updated_at, deleted_at.
       POST /environments/{envPk}/features/{featurePk}/versions/{uuid}/publish/
            body EnvironmentFeatureVersionPublish (live_from optional)
     A change is: reuse the feature's unpublished draft version (or
     create one), PUT the plain environment state inside it with the
     change applied, then publish. Only after publish does the live
     featurestates list — and so the executor's read-back — move. */
  RealAdapter.prototype._isVersioningError = function (e) {
    return !!e && typeof e.message === 'string' && /v2 feature versioning/i.test(e.message);
  };
  RealAdapter.prototype._nestedValue = function (v) {
    // A version-state read hands feature_state_value back as the nested
    // FeatureStateValue object already; pass it through trimmed to its
    // four keys. A scalar (or nothing) converts via _valueObject.
    if (v && typeof v === 'object') {
      return { type: v.type != null ? v.type : null,
               string_value: v.string_value != null ? v.string_value : null,
               integer_value: v.integer_value != null ? v.integer_value : null,
               boolean_value: v.boolean_value != null ? v.boolean_value : null };
    }
    return this._valueObject(v != null ? v : null);
  };
  RealAdapter.prototype._versionStateBody = function (rawState, mutate) {
    // The writable projection for CustomEnvironmentFeatureVersionFeatureState,
    // built from a fetched state (a version state, or the live raw state
    // when a state has to be created inside the version). mutate is
    // { enabled } and/or { value } where value is a nested value object.
    var body = { enabled: !!rawState.enabled };
    var seg = this._intField(rawState.feature_segment);
    if (seg !== undefined) body.feature_segment = seg;
    var mv = this._mvBody(rawState);
    if (mv) body.multivariate_feature_state_values = mv;
    body.feature_state_value = mutate.value !== undefined ? mutate.value
      : this._nestedValue(rawState.feature_state_value);
    if (mutate.enabled !== undefined) body.enabled = !!mutate.enabled;
    return body;
  };
  RealAdapter.prototype._applyChangeV2 = function (change, raw, mutate) {
    var self = this;
    var envPk = parseInt(change.envId, 10);
    var featureId = this._intField(raw.feature);
    if (!isFinite(envPk) || featureId === undefined) {
      return Promise.reject(new Error('Cannot address the feature version endpoints for ' + change.feature + ' (environment ' + change.envId + ').'));
    }
    var base = '/environments/' + envPk + '/features/' + featureId + '/versions/';
    return this._fetch(base).then(function (data) {
      var versions = (data && (data.results || data)) || [];
      for (var i = 0; i < versions.length; i++) {
        if (versions[i] && versions[i].published === false && versions[i].uuid) return versions[i].uuid;
      }
      return self._fetch(base, {
        method: 'POST',
        body: JSON.stringify({ description: 'FlagAgent change — ' + change.feature })
      }).then(function (created) {
        if (!created || !created.uuid) throw new Error('Flagsmith did not return a uuid for the new feature version of ' + change.feature + '.');
        return created.uuid;
      });
    }).then(function (versionUuid) {
      var statesPath = base + versionUuid + '/featurestates/';
      return self._fetch(statesPath).then(function (states) {
        var list = (states && (states.results || states)) || [];
        var target = null;
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          // The plain environment state: no segment, no identity.
          if (s && s.feature_segment == null && s.identity == null) { target = s; break; }
        }
        if (target) {
          return self._fetch(statesPath + target.id + '/', {
            method: 'PUT', body: JSON.stringify(self._versionStateBody(target, mutate))
          });
        }
        // A fresh version normally clones the live states; if the plain
        // state is not there, create it already carrying the change.
        return self._fetch(statesPath, {
          method: 'POST', body: JSON.stringify(self._versionStateBody(raw, mutate))
        });
      }).then(function () {
        return self._fetch(base + versionUuid + '/publish/', {
          method: 'POST', body: JSON.stringify({})
        });
      });
    });
  };
  RealAdapter.prototype._dispatchWrite = function (change, raw, legacyFn, mutate, detail) {
    // One write, two possible routes: the feature version flow when the
    // environment is known to be v2-versioned, the legacy PUT otherwise
    // — with a reactive switch (latched for the session) when the legacy
    // PUT is answered with the versioning 400.
    var self = this;
    var viaV2 = function () {
      return self._applyChangeV2(change, raw, mutate).then(function () { return { ok: true, detail: detail }; });
    };
    if (this._v2Envs[change.envId]) {
      return viaV2().catch(function (e) { return { ok: false, detail: e.message }; });
    }
    return legacyFn().then(function () { return { ok: true, detail: detail }; })
      .catch(function (e) {
        if (self._isVersioningError(e)) {
          self._v2Envs[change.envId] = true;
          return viaV2().catch(function (e2) { return { ok: false, detail: e2.message }; });
        }
        return { ok: false, detail: e.message };
      });
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
        return this._dispatchWrite(change, raw,
          function () {
            return self._envApiKey(change.envId).then(function (envKey) {
              return self._fetch('/environments/' + envKey + '/featurestates/' + sid + '/', {
                method: 'PUT', body: JSON.stringify(enabledBody)
              });
            });
          },
          { enabled: !!change.after.enabled },
          change.feature + ' is now ' + (change.after.enabled ? 'ON' : 'OFF') + '.');
      }
      case 'set_rollout': {
        var rollout = change.after.rollout;
        if (rollout !== 0 && rollout !== 100) {
          // No feature state has a percentage field — not on the v1
          // routes and not inside a feature version either (live
          // swagger, 26 Nov 2026): a partial rollout exists only as
          // per-variant percentage_allocation on a multivariate flag.
          // Refuse plainly rather than send a field the API does not have.
          return Promise.resolve({ ok: false, detail: 'A ' + rollout + '% rollout cannot be written through the Flagsmith API: feature states have no percentage field (rollout % lives only in multivariate variant weights). Turn the flag fully on or off, or plan a variant change.' });
        }
        var rolloutBody = this._projectedBody(raw);
        rolloutBody.enabled = rollout === 100;
        return this._dispatchWrite(change, raw,
          function () {
            return self._envApiKey(change.envId).then(function (envKey) {
              return self._fetch('/environments/' + envKey + '/featurestates/' + sid + '/', {
                method: 'PUT', body: JSON.stringify(rolloutBody)
              });
            });
          },
          { enabled: rollout === 100 },
          change.feature + ' rollout is now ' + rollout + '%.');
      }
      case 'set_value': {
        var valueBody = this._projectedBody(raw);
        if (valueBody.environment == null) valueBody.environment = parseInt(change.envId, 10);
        valueBody.feature_state_value = this._valueObject(change.after.value);
        return this._dispatchWrite(change, raw,
          function () {
            return self._fetch('/features/featurestates/' + sid + '/', {
              method: 'PUT', body: JSON.stringify(valueBody)
            });
          },
          { value: self._valueObject(change.after.value) },
          change.feature + ' value set.');
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
