/* FlagAgent hero 3D — three flag switches on a rail in front of the approval
   gate: levers flip on their own rhythm, lamps show the state, the gate arch
   only lights green when every switch holds. Three.js r160 UMD via jsDelivr.
   Auto-starts on first load; if the CDN is unreachable this is a guarded
   no-op and the page is unchanged. Drag to spin. Pauses on
   prefers-reduced-motion, body.low-motion, or a hidden tab. */
(function () {
  var canvas = document.getElementById('hero3d');
  if (!canvas) return;

  function motionOK() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !document.body.classList.contains('low-motion');
  }

  function start() {
    if (!window.THREE) return; // CDN unreachable — leave the page as-is
    var THREE = window.THREE;
    var wrap = canvas.parentElement;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c100e);
    scene.fog = new THREE.Fog(0x0c100e, 16, 30);
    var camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
    camera.position.set(0, 4.6, 12.5);
    camera.lookAt(0, 1.4, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var key = new THREE.DirectionalLight(0xe8ede9, 1.0);
    key.position.set(5, 9, 7);
    scene.add(key);
    var greenWash = new THREE.PointLight(0x46d17c, 1.4, 18);
    greenWash.position.set(0, 4, 3);
    scene.add(greenWash);

    var rig = new THREE.Group();
    scene.add(rig);

    // Floor
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      new THREE.MeshStandardMaterial({ color: 0x141a17, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    rig.add(floor);
    var grid = new THREE.GridHelper(20, 20, 0x26302a, 0x1a221d);
    grid.position.y = 0.01;
    rig.add(grid);

    // The gate arch at the back
    var gateMat = new THREE.MeshStandardMaterial({ color: 0x1a221d, roughness: 0.6, metalness: 0.3 });
    [-3.4, 3.4].forEach(function (x) {
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.6, 0.5), gateMat);
      post.position.set(x, 2.3, -3.2);
      rig.add(post);
    });
    var lintel = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.5, 0.5), gateMat);
    lintel.position.set(0, 4.75, -3.2);
    rig.add(lintel);
    var gateLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x46d17c, emissive: 0x46d17c, emissiveIntensity: 1.6 })
    );
    gateLamp.position.set(0, 4.75, -2.8);
    rig.add(gateLamp);

    // Rail + three switches
    var rail = new THREE.Mesh(
      new THREE.BoxGeometry(10.5, 0.3, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x1a221d, roughness: 0.6, metalness: 0.4 })
    );
    rail.position.set(0, 0.85, 0);
    rig.add(rail);
    [-3.4, 3.4].forEach(function (x) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.85, 0.35), gateMat);
      leg.position.set(x, 0.42, 0);
      rig.add(leg);
    });

    var switches = [];
    var defs = [
      { x: -3.2, on: true, color: 0x46d17c, period: 4.2, offset: 0.0 },
      { x: 0, on: false, color: 0xf2b33d, period: 5.6, offset: 1.3 },
      { x: 3.2, on: true, color: 0x46d17c, period: 6.8, offset: 2.6 }
    ];
    defs.forEach(function (d) {
      var g = new THREE.Group();
      g.position.set(d.x, 1.0, 0);
      var base = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.5, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x232d27, roughness: 0.55, metalness: 0.35 })
      );
      base.position.y = 0.25;
      g.add(base);
      // Slot
      var slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.1, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x0c100e, roughness: 0.9 })
      );
      slot.position.set(0, 0.52, 0);
      g.add(slot);
      // Lever pivots around its base so it can flip
      var pivot = new THREE.Group();
      pivot.position.set(0, 0.52, 0);
      var lever = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 1.5, 12),
        new THREE.MeshStandardMaterial({ color: 0xe8ede9, roughness: 0.35, metalness: 0.6 })
      );
      lever.position.y = 0.75;
      pivot.add(lever);
      var knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 16),
        new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.9, roughness: 0.3 })
      );
      knob.position.y = 1.55;
      pivot.add(knob);
      pivot.rotation.x = d.on ? -0.55 : 0.55;
      g.add(pivot);
      // Lamp
      var lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 14, 14),
        new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: d.on ? 1.8 : 0.25 })
      );
      lamp.position.set(0.72, 0.55, 0);
      g.add(lamp);
      rig.add(g);
      switches.push({ pivot: pivot, lamp: lamp, def: d, on: d.on });
    });

    // Circuit lines from each switch to the gate
    var lineMat = new THREE.LineBasicMaterial({ color: 0x46d17c, transparent: true, opacity: 0.5 });
    defs.forEach(function (d) {
      var pts = [new THREE.Vector3(d.x, 1.0, -0.4), new THREE.Vector3(d.x * 0.6, 0.08, -1.8), new THREE.Vector3(d.x * 0.6, 0.08, -3.2)];
      var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
      rig.add(line);
    });

    var targetRotY = 0, rotY = 0, dragging = false, lastX = 0, lastY = 0, tiltX = 0, targetTilt = 0;
    canvas.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      targetRotY += (e.clientX - lastX) * 0.008;
      targetTilt = Math.max(-0.2, Math.min(0.3, targetTilt + (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      canvas.addEventListener(ev, function () { dragging = false; });
    });

    function resize() {
      var w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    var clock = new THREE.Clock();
    var raf = null;
    function allOn() { return switches.every(function (s) { return s.on; }); }
    function frame() {
      raf = null;
      var t = clock.getElapsedTime();
      if (!motionOK()) { renderer.render(scene, camera); return; } // one static frame
      rotY += (targetRotY - rotY) * 0.06;
      tiltX += (targetTilt - tiltX) * 0.06;
      rig.rotation.y = rotY + Math.sin(t * 0.1) * 0.05;
      rig.rotation.x = tiltX;
      switches.forEach(function (s) {
        var cycle = (t + s.def.offset) % s.def.period;
        var want = cycle < s.def.period / 2 ? s.def.on : !s.def.on;
        // flip slowly toward the wanted angle; lamp follows the lever
        var target = want ? -0.55 : 0.55;
        s.pivot.rotation.x += (target - s.pivot.rotation.x) * 0.04;
        var lit = Math.abs(s.pivot.rotation.x - (want ? -0.55 : 0.55)) < 0.3 ? want : s.on;
        s.lamp.material.emissiveIntensity += ((lit ? 1.8 : 0.25) - s.lamp.material.emissiveIntensity) * 0.08;
        s.on = want;
      });
      var gateOn = allOn();
      gateLamp.material.color.setHex(gateOn ? 0x46d17c : 0xe5534b);
      gateLamp.material.emissive.setHex(gateOn ? 0x46d17c : 0xe5534b);
      greenWash.color.setHex(gateOn ? 0x46d17c : 0xe5534b);
      renderer.render(scene, camera);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (raf === null && !document.hidden) raf = requestAnimationFrame(frame); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { clock.getDelta(); kick(); } });
    document.getElementById('motionToggle').addEventListener('click', function () {
      setTimeout(function () { if (motionOK()) { clock.getDelta(); kick(); } else { renderer.render(scene, camera); } }, 0);
    });
    kick();
    if (!motionOK()) renderer.render(scene, camera);
  }

  if (window.THREE) { start(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  s.onload = start;
  s.onerror = function () { /* CDN unreachable — page stays as-is */ };
  document.head.appendChild(s);
})();
