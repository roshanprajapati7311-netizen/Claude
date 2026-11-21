/*
  KAIVRA — holographic core (v0.1)
  Pure canvas, no libraries, works offline.

  Gestures
    drag ............ rotate the core 360°
    pinch / scroll .. zoom in, layer by layer, down to the kernel
    tap the core .... wake Kaivra (tap again, or wait, and it goes back to standby)
    double-tap space  reset the view

  Native bridge (Android): window.KaivraNative.speak(text), .vibrate(ms), .version()
  Page API for native code: window.Kaivra.activate(), .deactivate(), .toggle(),
                            .zoomTo(dist), .setLayerInfo(key, text)
*/
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const cv = document.getElementById('core');
  const ctx = cv.getContext('2d');
  const native = window.KaivraNative || null;

  // ---------- palette (amber hologram) ----------
  const AMBER = [255, 172, 64];
  const GOLD = [255, 210, 130];
  const HOT = [255, 240, 205];
  const DEEP = [255, 118, 22];
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a <= 0 ? 0 : a >= 1 ? 1 : a.toFixed(3)) + ')';
  const FONT = 'ui-monospace, "Roboto Mono", "Droid Sans Mono", monospace';

  // ---------- math ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  function mul(A, B) {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return C;
  }
  const scaleM = (A, s) => A.map(v => v * s);

  // ---------- viewport ----------
  let W = 0, H = 0, DPR = 1, F = 1, CX = 0, CY = 0, MIN = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    MIN = Math.min(W, H);
    F = MIN * 0.95;
    CX = W / 2; CY = H * 0.47;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- camera ----------
  const DIST_HOME = 4.6, DIST_MAX = 5.4, DIST_MIN = 0.3;
  const cam = { yaw: 0.5, pitch: 0.3, vYaw: 0, vPitch: 0, dist: 9, target: DIST_HOME };
  let camM = mul(rotX(cam.pitch), rotY(cam.yaw));

  // project a model point through matrix M; result in o = [screenX, screenY, scale, depthZ]
  const o = new Float64Array(4);
  function P(M, x, y, z) {
    const X = M[0] * x + M[1] * y + M[2] * z;
    const Y = M[3] * x + M[4] * y + M[5] * z;
    const Z = M[6] * x + M[7] * y + M[8] * z;
    const d = cam.dist - Z;
    if (d < 0.05) return false;
    const s = F / d;
    o[0] = CX + X * s; o[1] = CY - Y * s; o[2] = s; o[3] = Z;
    return true;
  }
  // on-screen radius of a sphere of radius r centred at the origin
  const silR = r => F * r / Math.sqrt(Math.max(cam.dist * cam.dist - r * r, 0.0009));

  // ---------- geometry ----------
  function ring(n, y, rad) {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const t = i / n * TAU; a[i * 3] = Math.cos(t) * rad; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(t) * rad; }
    return a;
  }
  const latitude = (phi, n) => ring(n, Math.sin(phi), Math.cos(phi));
  function meridian(theta, n, from = 0, to = TAU) {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = from + (to - from) * (i / (to - from === TAU ? n : n - 1));
      a[i * 3] = Math.cos(t) * Math.cos(theta); a[i * 3 + 1] = Math.sin(t); a[i * 3 + 2] = Math.cos(t) * Math.sin(theta);
    }
    return a;
  }
  function fib(n) {
    const a = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), t = g * i;
      a[i * 3] = Math.cos(t) * r; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(t) * r;
    }
    return a;
  }
  function icosphere() {
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const norm = p => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
    v = v.map(norm);
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(key)) return cache.get(key);
      v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
      cache.set(key, v.length - 1);
      return v.length - 1;
    };
    const edges = new Set();
    const addE = (a, b) => edges.add(a < b ? a + '_' + b : b + '_' + a);
    for (const [a, b, c] of f) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      addE(a, ab); addE(ab, b); addE(b, bc); addE(bc, c); addE(c, ca); addE(ca, a); addE(ab, bc); addE(bc, ca); addE(ca, ab);
    }
    return { v, e: [...edges].map(s => s.split('_').map(Number)) };
  }
  function dodecaDirs() {
    const p = (1 + Math.sqrt(5)) / 2, q = 1 / p, out = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) { out.push([0, a * q, b * p]); out.push([a * q, b * p, 0]); out.push([a * p, 0, b * q]); }
    return out.map(v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  }

  const RING128 = ring(128, 0, 1);
  const SHELL_LATS = []; for (let d = -75; d <= 75; d += 15) SHELL_LATS.push(latitude(d * Math.PI / 180, 72));
  const SHELL_MERS = []; for (let i = 0; i < 9; i++) SHELL_MERS.push(meridian(i * Math.PI / 9, 72));
  const NDOTS = 900;
  const SHELL_DOTS = fib(NDOTS);
  const LAND = new Float32Array(NDOTS);
  for (let i = 0; i < NDOTS; i++) {
    const x = SHELL_DOTS[i * 3], y = SHELL_DOTS[i * 3 + 1], z = SHELL_DOTS[i * 3 + 2];
    const n = Math.sin(2.7 * x + 1.3) * Math.sin(3.1 * y + 0.2) * Math.sin(2.3 * z + 2.4)
      + 0.55 * Math.sin(5.3 * x - 2.1 * z + 0.7) * Math.sin(4.7 * y + 1.9 * x)
      + 0.3 * Math.sin(9.1 * z + 3.3 * y);
    LAND[i] = smooth(0.02, 0.3, n);
  }
  const ICO = icosphere();
  const ICO_P = new Float32Array(ICO.v.length * 3);
  const ICO_OK = new Uint8Array(ICO.v.length);
  const VAULTS = dodecaDirs();
  const AGENT_BANDS = [
    { lat: -0.72, n: 12, sp: 0.55 }, { lat: -0.26, n: 18, sp: -0.38 },
    { lat: 0.2, n: 18, sp: 0.3 }, { lat: 0.66, n: 12, sp: -0.48 },
  ].map(b => Object.assign(b, { curve: latitude(b.lat, 64) }));
  const BRAIN_LOW = []; for (let d = -78; d <= -8; d += 14) BRAIN_LOW.push(latitude(d * Math.PI / 180, 48));
  const BRAIN_MERS = []; for (let i = 0; i < 10; i++) BRAIN_MERS.push(meridian(i * TAU / 10, 16, -Math.PI / 2, 0));
  const BRAIN_EQ = ring(64, 0, 1);
  const BRAIN_DOTS = (() => { const f = fib(220), out = []; for (let i = 0; i < 220; i++) if (f[i * 3 + 1] > 0.1) out.push(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]); return new Float32Array(out); })();
  const NDUST = 70;
  const DUST = new Float32Array(NDUST * 4);
  for (let i = 0; i < NDUST; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * TAU, r = 2.5 + Math.random() * 1.3, s = Math.sqrt(1 - u * u);
    DUST[i * 4] = Math.cos(th) * s * r; DUST[i * 4 + 1] = u * r; DUST[i * 4 + 2] = Math.sin(th) * s * r; DUST[i * 4 + 3] = Math.random();
  }

  // outer satellites: rings of blade panels
  const BLADE_RINGS = [
    { r: 1.48, tx: 0.42, tz: 0.18, n: 5, span: 0.46, w: 0.11, sp: 0.16, ph: 0.0 },
    { r: 1.74, tx: -0.62, tz: -0.3, n: 4, span: 0.55, w: 0.13, sp: -0.11, ph: 1.2 },
    { r: 2.0, tx: 1.2, tz: 0.55, n: 6, span: 0.32, w: 0.085, sp: 0.075, ph: 2.1 },
  ];

  // ---------- layers (outside → in) ----------
  const LAYERS = [
    { key: 'shell', name: 'SHELL', info: 'interface · outer hull', r: 1.0, lo: 1.75, hi: 3.0, base: 1 },
    { key: 'plugins', name: 'PLUGINS', info: '0 installed', r: 0.78, lo: 1.3, hi: 1.75, base: 0.32 },
    { key: 'agents', name: 'AGENTS', info: '0 running', r: 0.58, lo: 0.95, hi: 1.3, base: 0.26 },
    { key: 'vaults', name: 'MEMORY VAULTS', info: '20 vaults · empty', r: 0.4, lo: 0.68, hi: 0.95, base: 0.24 },
    { key: 'brain', name: 'BRAIN', info: 'offline ● · online ○', r: 0.24, lo: 0.45, hi: 0.68, base: 0.3 },
    { key: 'kernel', name: 'KERNEL', info: 'v0.1 · owner-locked', r: 0.09, lo: 0, hi: 0.45, base: 0.85 },
  ];
  try { if (native && native.version) LAYERS[5].info = 'v' + native.version() + ' · owner-locked'; } catch (_) {}
  function layerAlpha(L) {
    const fade = L.lo > 0 ? smooth(L.lo * 0.8, L.lo, cam.dist) : 1;
    const reveal = 1 - smooth(L.hi, L.hi * 1.8, cam.dist);
    return fade * lerp(L.base, 1, reveal);
  }
  function focusLayer() {
    if (cam.dist > 3.0) return null;
    for (let i = LAYERS.length - 1; i >= 0; i--) { const L = LAYERS[i]; if (cam.dist <= L.hi && cam.dist > L.lo) return L; }
    return LAYERS[0];
  }

  // ---------- drawing helpers ----------
  function addCurve(M, pts, closed, zc, pf, pb) {
    const n = pts.length / 3, last = closed ? n : n - 1;
    let prevOk = false, side = -1, px = 0, py = 0, pz = 0;
    for (let i = 0; i <= last; i++) {
      const k = (i % n) * 3;
      const ok = P(M, pts[k], pts[k + 1], pts[k + 2]);
      if (ok && prevOk) {
        const s = (o[3] + pz) * 0.5 > zc ? 1 : 0;
        const path = s ? pf : pb;
        if (s !== side) path.moveTo(px, py);
        path.lineTo(o[0], o[1]);
        side = s;
      } else side = -1;
      if (ok) { px = o[0]; py = o[1]; pz = o[3]; }
      prevOk = ok;
    }
  }
  function strokePair(pf, pb, col, a, w, backK) {
    if (a <= 0.003) return;
    ctx.lineWidth = w;
    ctx.strokeStyle = rgba(col, a * backK); ctx.stroke(pb);
    ctx.strokeStyle = rgba(col, a); ctx.stroke(pf);
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.1), 0, TAU); }

  const BK = 12;
  const bladeO = new Float32Array((BK + 1) * 2), bladeI = new Float32Array((BK + 1) * 2);
  const bp = (M, ang, rad, y) => P(M, Math.cos(ang) * rad, y, Math.sin(ang) * rad);
  function drawBlade(M, rr, w, a0, span, alpha) {
    if (!bp(M, a0 + span * 0.45, rr, 0)) return;
    const a = alpha * (0.22 + 0.78 * smooth(-rr * 0.6, rr * 0.6, o[3]));
    if (a < 0.01) return;
    for (let i = 0; i <= BK; i++) {
      const u = i / BK, hw = w * Math.sin(Math.PI * Math.pow(u, 0.75)), ang = a0 + span * u;
      if (!bp(M, ang, rr + hw, hw * 0.18)) return;
      bladeO[i * 2] = o[0]; bladeO[i * 2 + 1] = o[1];
      if (!bp(M, ang, rr - hw * 0.55, -hw * 0.1)) return;
      bladeI[i * 2] = o[0]; bladeI[i * 2 + 1] = o[1];
    }
    const path = new Path2D();
    path.moveTo(bladeO[0], bladeO[1]);
    for (let i = 1; i <= BK; i++) path.lineTo(bladeO[i * 2], bladeO[i * 2 + 1]);
    for (let i = BK; i >= 0; i--) path.lineTo(bladeI[i * 2], bladeI[i * 2 + 1]);
    path.closePath();
    ctx.fillStyle = rgba(DEEP, 0.17 * a); ctx.fill(path);
    ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(GOLD, 0.85 * a); ctx.stroke(path);
    const seams = new Path2D();
    for (const k of [3, 6, 9]) { seams.moveTo(bladeO[k * 2], bladeO[k * 2 + 1]); seams.lineTo(bladeI[k * 2], bladeI[k * 2 + 1]); }
    let first = true;
    for (let i = 1; i < BK; i++) {
      const u = i / BK;
      if (!bp(M, a0 + span * u, rr + w * 0.12 * Math.sin(Math.PI * u), 0.02)) break;
      if (first) { seams.moveTo(o[0], o[1]); first = false; } else seams.lineTo(o[0], o[1]);
    }
    ctx.lineWidth = 0.7; ctx.strokeStyle = rgba(AMBER, 0.55 * a); ctx.stroke(seams);
    if (bp(M, a0 + span * 0.42, rr, 0)) {
      const s = 1.4 + o[2] * 0.0035;
      ctx.fillStyle = rgba(HOT, 0.9 * a); ctx.fillRect(o[0] - s, o[1] - s, s * 2, s * 2);
    }
  }

  // ---------- state, voice, haptics ----------
  const now = () => performance.now() / 1000;
  const state = { active: false, act: 0, activeSince: 0, pulses: [], hintSeen: false, lastZoom: -1e9 };
  try { state.hintSeen = localStorage.getItem('kaivra.hint') === '1'; } catch (_) {}
  const AUTO_SLEEP = 12;
  let lastInteract = -1e9;

  function speak(text) {
    if (native && native.speak) { try { native.speak(text); return; } catch (_) {} }
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = 0.85;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      }
    } catch (_) {}
  }
  function buzz(ms) {
    if (native && native.vibrate) { try { native.vibrate(ms); return; } catch (_) {} }
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
  }
  let actx = null;
  function hum(up) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime, g = actx.createGain();
      g.connect(actx.destination);
      const o1 = actx.createOscillator(), o2 = actx.createOscillator();
      o1.type = 'sine'; o2.type = 'triangle';
      const f0 = up ? 70 : 180, f1 = up ? 190 : 58;
      o1.frequency.setValueAtTime(f0, t0); o1.frequency.exponentialRampToValueAtTime(f1, t0 + 0.6);
      o2.frequency.setValueAtTime(f0 * 2.01, t0); o2.frequency.exponentialRampToValueAtTime(f1 * 2.01, t0 + 0.6);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(up ? 0.11 : 0.05, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o1.connect(g); o2.connect(g);
      o1.start(t0); o2.start(t0); o1.stop(t0 + 0.95); o2.stop(t0 + 0.95);
    } catch (_) {}
  }

  function activate() {
    if (state.active) return;
    state.active = true; state.activeSince = now();
    state.pulses.push(now()); setTimeout(() => state.pulses.push(now()), 220);
    hum(true); buzz(28); speak('Kaivra online.');
    if (!state.hintSeen) { state.hintSeen = true; try { localStorage.setItem('kaivra.hint', '1'); } catch (_) {} }
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false; hum(false); buzz(12);
  }
  function resetView() { cam.target = DIST_HOME; cam.vYaw = cam.vPitch = 0; state.lastZoom = now(); }

  window.Kaivra = {
    activate, deactivate,
    toggle() { if (state.active) deactivate(); else activate(); },
    zoomTo(d) { cam.target = clamp(+d || DIST_HOME, DIST_MIN, DIST_MAX); state.lastZoom = now(); },
    setLayerInfo(key, info) { const L = LAYERS.find(l => l.key === key); if (L) L.info = String(info); },
    get active() { return state.active; },
  };

  // ---------- input ----------
  const pointers = new Map();
  let tap = null, pinch = null, lastTapTime = 0;
  const span = () => { const p = [...pointers.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; };

  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now() });
    lastInteract = now();
    if (pointers.size === 1) { tap = { x: e.clientX, y: e.clientY, t: now(), moved: false }; cam.vYaw = cam.vPitch = 0; pinch = null; }
    else if (pointers.size === 2) { tap = null; pinch = { span: span(), dist: cam.target }; }
  });
  cv.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, tn = now(), dt = Math.max(tn - p.t, 0.008);
    p.x = e.clientX; p.y = e.clientY; p.t = tn;
    lastInteract = tn;
    if (pointers.size === 1 && !pinch) {
      const k = 3.4 / MIN;
      cam.yaw += dx * k; cam.pitch += dy * k;
      cam.vYaw = lerp(cam.vYaw, dx * k / dt, 0.35); cam.vPitch = lerp(cam.vPitch, dy * k / dt, 0.35);
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) tap.moved = true;
    } else if (pointers.size === 2 && pinch) {
      cam.target = clamp(pinch.dist * pinch.span / span(), DIST_MIN, DIST_MAX);
      state.lastZoom = tn;
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) { cam.vYaw = cam.vPitch = 0; }
    if (pointers.size === 0 && tap && !tap.moved && now() - tap.t < 0.4 && e.type === 'pointerup') handleTap(e.clientX, e.clientY);
    if (pointers.size === 0) tap = null;
    if (Math.abs(cam.vYaw) < 0.05) cam.vYaw = 0;
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    cam.target = clamp(cam.target * Math.exp(e.deltaY * 0.0012), DIST_MIN, DIST_MAX);
    state.lastZoom = now(); lastInteract = now();
  }, { passive: false });

  function handleTap(x, y) {
    const tn = now();
    const onCore = Math.hypot(x - CX, y - CY) < Math.max(silR(1) * 1.15, 56);
    if (!onCore) {
      if (tn - lastTapTime < 0.38) { resetView(); lastTapTime = 0; } else lastTapTime = tn;
      return;
    }
    lastTapTime = 0;
    if (state.active) deactivate(); else activate();
  }

  // ---------- render ----------
  let last = now(), t = 0;
  function frame() {
    const tn = now();
    const dt = Math.min(0.05, tn - last); last = tn; t += dt;

    if (pointers.size === 0) {
      cam.yaw += cam.vYaw * dt; cam.pitch += cam.vPitch * dt;
      const damp = Math.exp(-dt * 2.4); cam.vYaw *= damp; cam.vPitch *= damp;
      if (tn - lastInteract > 2.5) cam.yaw += dt * (0.05 + 0.12 * state.act);
    }
    cam.dist += (cam.target - cam.dist) * (1 - Math.exp(-dt * (cam.dist > 6 ? 2.2 : 7)));
    state.act += ((state.active ? 1 : 0) - state.act) * (1 - Math.exp(-dt * (state.active ? 3.2 : 1.6)));
    if (state.active && tn - Math.max(state.activeSince, lastInteract) > AUTO_SLEEP) deactivate();
    camM = mul(rotX(cam.pitch), rotY(cam.yaw));

    draw(tn);
    requestAnimationFrame(frame);
  }

  function draw(tn) {
    const act = state.act, d = cam.dist;
    const glow = 0.8 + 0.3 * act + 0.04 * Math.sin(t * 1.3);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050302'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    const cx = CX, cy = CY, R1 = silR(1);
    let g;

    // background bloom
    const bloomR = Math.max(MIN * 0.8, R1 * 2.6);
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, bloomR);
    const bk = 0.3 + 0.7 * smooth(1.4, 3.4, d);
    g.addColorStop(0, rgba(DEEP, 0.11 * glow * bk)); g.addColorStop(0.45, rgba(DEEP, 0.035 * glow * bk)); g.addColorStop(1, rgba(DEEP, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // drifting dust
    const dustA = smooth(2.7, 3.9, d);
    if (dustA > 0.01) {
      const M = mul(camM, rotY(t * 0.012));
      for (let i = 0; i < NDUST; i++) {
        if (!P(M, DUST[i * 4], DUST[i * 4 + 1], DUST[i * 4 + 2])) continue;
        const a = dustA * (0.18 + 0.5 * DUST[i * 4 + 3]) * (0.4 + 0.6 * smooth(-3, 3, o[3])) * (0.7 + 0.3 * Math.sin(t * 1.7 + i));
        const sz = 0.7 + o[2] * 0.003;
        ctx.fillStyle = rgba(GOLD, a); ctx.fillRect(o[0], o[1], sz, sz);
      }
    }

    // ===== layer 0: shell (planet + atmosphere) =====
    const aS = layerAlpha(LAYERS[0]) * glow;
    if (aS > 0.004) {
      // atmosphere
      g = ctx.createRadialGradient(cx, cy, R1 * 0.86, cx, cy, R1 * 1.6);
      g.addColorStop(0, rgba(AMBER, 0)); g.addColorStop(0.2, rgba(AMBER, 0.26 * aS));
      g.addColorStop(0.36, rgba(DEEP, 0.1 * aS)); g.addColorStop(1, rgba(DEEP, 0));
      ctx.fillStyle = g; circle(cx, cy, R1 * 1.6); ctx.fill();
      // body with limb glow
      g = ctx.createRadialGradient(cx - R1 * 0.25, cy - R1 * 0.3, 0, cx, cy, R1);
      g.addColorStop(0, rgba(DEEP, 0.09 * aS)); g.addColorStop(0.75, rgba(DEEP, 0.05 * aS)); g.addColorStop(1, rgba(AMBER, 0.2 * aS));
      ctx.fillStyle = g; circle(cx, cy, R1); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(GOLD, 0.4 * aS); circle(cx, cy, R1); ctx.stroke();
      ctx.lineWidth = 0.6; ctx.strokeStyle = rgba(AMBER, 0.22 * aS); circle(cx, cy, R1 * 1.07); ctx.stroke();

      const Ms = mul(camM, rotY(t * 0.045));
      const zc = 1 / d;
      const pf = new Path2D(), pb = new Path2D();
      for (const c of SHELL_LATS) addCurve(Ms, c, true, zc, pf, pb);
      for (const c of SHELL_MERS) addCurve(Ms, c, true, zc, pf, pb);
      strokePair(pf, pb, AMBER, 0.3 * aS, 0.7, 0.22);

      // surface dots, batched by brightness
      const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const sBase = Math.sqrt(4.6 / F);
      for (let i = 0; i < NDOTS; i++) {
        if (!P(Ms, SHELL_DOTS[i * 3], SHELL_DOTS[i * 3 + 1], SHELL_DOTS[i * 3 + 2])) continue;
        const land = LAND[i], front = o[3] > zc;
        const v = (front ? 1 : 0.16) * (0.22 + 0.78 * land);
        const b = Math.min(3, Math.floor(v * 4));
        const sz = (0.7 + 1.5 * land) * clamp(Math.sqrt(o[2]) * sBase, 0.6, 5);
        buckets[b].rect(o[0] - sz / 2, o[1] - sz / 2, sz, sz);
      }
      const BA = [0.14, 0.34, 0.6, 0.95];
      for (let b = 0; b < 4; b++) { ctx.fillStyle = rgba(GOLD, BA[b] * aS); ctx.fill(buckets[b]); }
    }

    // ===== equator gauge ring =====
    const aG = smooth(1.9, 2.7, d) * glow;
    if (aG > 0.004) {
      const Mg = mul(camM, mul(rotZ(-0.09), mul(rotX(0.12), rotY(-t * 0.05))));
      const r = 1.24, zc = r * r / d;
      const pf = new Path2D(), pb = new Path2D();
      addCurve(scaleM(Mg, r), RING128, true, zc, pf, pb);
      for (let k = 0; k < 120; k++) {
        const ang = k / 120 * TAU, len = k % 10 === 0 ? 0.075 : k % 5 === 0 ? 0.045 : 0.022;
        const c = Math.cos(ang), s = Math.sin(ang);
        if (!P(Mg, c * r, 0, s * r)) continue;
        const x0 = o[0], y0 = o[1], z0 = o[3];
        if (!P(Mg, c * (r + len), 0, s * (r + len))) continue;
        const path = (z0 + o[3]) / 2 > zc ? pf : pb;
        path.moveTo(x0, y0); path.lineTo(o[0], o[1]);
      }
      strokePair(pf, pb, GOLD, 0.5 * aG, 0.8, 0.25);
    }

    // ===== orbiting blade satellites =====
    const aB = smooth(2.5, 3.4, d) * glow;
    if (aB > 0.004) {
      for (const B of BLADE_RINGS) {
        const Mb = mul(camM, mul(rotZ(B.tz), rotX(B.tx)));
        const rr = B.r * (1 + 0.1 * act);
        const pf = new Path2D(), pb = new Path2D();
        addCurve(scaleM(Mb, rr), RING128, true, rr * rr / d, pf, pb);
        ctx.setLineDash([1.5, 5]);
        strokePair(pf, pb, AMBER, 0.38 * aB, 0.8, 0.3);
        ctx.setLineDash([]);
        const spin = B.ph + t * B.sp * (1 + 1.6 * act);
        for (let j = 0; j < B.n; j++) drawBlade(Mb, rr, B.w * (1 + 0.25 * act), spin + j * TAU / B.n, B.span, aB);
      }
    }

    // ===== layer 1: plugins (geodesic lattice) =====
    const aP = layerAlpha(LAYERS[1]) * glow;
    if (aP > 0.004) {
      const r = LAYERS[1].r, zc = r * r / d;
      const M = scaleM(mul(camM, mul(rotX(0.3), rotY(-t * 0.08))), r);
      for (let i = 0; i < ICO.v.length; i++) {
        const v = ICO.v[i];
        ICO_OK[i] = P(M, v[0], v[1], v[2]) ? 1 : 0;
        ICO_P[i * 3] = o[0]; ICO_P[i * 3 + 1] = o[1]; ICO_P[i * 3 + 2] = o[3];
      }
      const pf = new Path2D(), pb = new Path2D();
      for (const [a, b] of ICO.e) {
        if (!ICO_OK[a] || !ICO_OK[b]) continue;
        const path = (ICO_P[a * 3 + 2] + ICO_P[b * 3 + 2]) / 2 > zc ? pf : pb;
        path.moveTo(ICO_P[a * 3], ICO_P[a * 3 + 1]); path.lineTo(ICO_P[b * 3], ICO_P[b * 3 + 1]);
      }
      strokePair(pf, pb, AMBER, 0.55 * aP, 0.8, 0.22);
      for (let i = 0; i < 12; i++) {
        if (!ICO_OK[i]) continue;
        const front = ICO_P[i * 3 + 2] > zc, s = 2.2 * clamp(silR(r) / (MIN * 0.15), 0.7, 3);
        const x = ICO_P[i * 3], y = ICO_P[i * 3 + 1];
        ctx.fillStyle = rgba(HOT, (front ? 0.9 : 0.25) * aP);
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
      }
    }

    // ===== layer 2: agents (orbiting comets) =====
    const aA = layerAlpha(LAYERS[2]) * glow;
    if (aA > 0.004) {
      const r = LAYERS[2].r, zc = r * r / d;
      const M = scaleM(mul(camM, rotX(-0.2)), r);
      const pf = new Path2D(), pb = new Path2D(), tf = new Path2D(), tb = new Path2D();
      const heads = [];
      for (const B of AGENT_BANDS) {
        addCurve(M, B.curve, true, zc, pf, pb);
        const y = Math.sin(B.lat), cr = Math.cos(B.lat), dir = Math.sign(B.sp);
        for (let j = 0; j < B.n; j++) {
          const a0 = j / B.n * TAU + t * B.sp * (1 + act);
          if (!P(M, Math.cos(a0) * cr, y, Math.sin(a0) * cr)) continue;
          const hx = o[0], hy = o[1], hz = o[3];
          heads.push(hx, hy, hz);
          const a1 = a0 - dir * 0.22;
          if (!P(M, Math.cos(a1) * cr, y, Math.sin(a1) * cr)) continue;
          const path = hz > zc ? tf : tb;
          path.moveTo(hx, hy); path.lineTo(o[0], o[1]);
        }
      }
      strokePair(pf, pb, AMBER, 0.22 * aA, 0.6, 0.3);
      strokePair(tf, tb, GOLD, 0.75 * aA, 1.3, 0.25);
      const hs = 1.3 * clamp(silR(r) / (MIN * 0.12), 0.8, 3);
      for (let i = 0; i < heads.length; i += 3) {
        ctx.fillStyle = rgba(HOT, (heads[i + 2] > zc ? 0.95 : 0.25) * aA);
        ctx.fillRect(heads[i] - hs, heads[i + 1] - hs, hs * 2, hs * 2);
      }
    }

    // ===== layer 3: memory vaults =====
    const aV = layerAlpha(LAYERS[3]) * glow;
    if (aV > 0.004) {
      const r = LAYERS[3].r, zc = r * r / d;
      const M = scaleM(mul(camM, mul(rotZ(0.4), rotY(t * 0.06))), r);
      const conduits = new Path2D(), boxesF = new Path2D(), boxesB = new Path2D();
      const s = clamp(silR(r) * 0.085, 2.5, 40);
      for (const v of VAULTS) {
        if (!P(M, v[0], v[1], v[2])) continue;
        const x = o[0], y = o[1], front = o[3] > zc;
        conduits.moveTo(cx, cy); conduits.lineTo(x, y);
        const p = front ? boxesF : boxesB;
        p.rect(x - s, y - s * 0.75, s * 2, s * 1.5);
        p.moveTo(x - s * 0.6, y); p.lineTo(x + s * 0.6, y);
        p.moveTo(x - s * 0.2, y - s * 0.35); p.lineTo(x + s * 0.2, y - s * 0.35);
      }
      ctx.lineWidth = 0.6; ctx.strokeStyle = rgba(DEEP, 0.28 * aV); ctx.stroke(conduits);
      strokePair(boxesF, boxesB, GOLD, 0.85 * aV, 1, 0.25);
    }

    // ===== layer 4: brain (offline below, online above) =====
    const aBr = layerAlpha(LAYERS[4]) * glow;
    if (aBr > 0.004) {
      const r = LAYERS[4].r, zc = r * r / d;
      const M = scaleM(mul(camM, rotY(t * 0.22)), r);
      const pf = new Path2D(), pb = new Path2D();
      for (const c of BRAIN_LOW) addCurve(M, c, true, zc, pf, pb);
      for (const c of BRAIN_MERS) addCurve(M, c, false, zc, pf, pb);
      strokePair(pf, pb, DEEP, 0.8 * aBr, 0.8, 0.3);
      const ef = new Path2D(), eb = new Path2D();
      addCurve(M, BRAIN_EQ, true, zc, ef, eb);
      strokePair(ef, eb, GOLD, 0.9 * aBr, 1.4, 0.35);
      const ds = clamp(silR(r) * 0.03, 0.8, 6);
      for (let i = 0; i < BRAIN_DOTS.length; i += 3) {
        if (!P(M, BRAIN_DOTS[i], BRAIN_DOTS[i + 1], BRAIN_DOTS[i + 2])) continue;
        const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.3 + i * 1.7));
        ctx.fillStyle = rgba(HOT, (o[3] > zc ? 0.8 : 0.2) * tw * aBr);
        ctx.fillRect(o[0] - ds / 2, o[1] - ds / 2, ds, ds);
      }
      const sa = t * 1.4;
      if (P(M, Math.cos(sa), 0, Math.sin(sa))) {
        g = ctx.createRadialGradient(o[0], o[1], 0, o[0], o[1], ds * 5);
        g.addColorStop(0, rgba(HOT, aBr)); g.addColorStop(1, rgba(GOLD, 0));
        ctx.fillStyle = g; circle(o[0], o[1], ds * 5); ctx.fill();
      }
    }

    // ===== layer 5: kernel =====
    const aK = layerAlpha(LAYERS[5]) * glow;
    {
      const ks = silR(0.09) * (1 + 0.07 * Math.sin(t * 2.6) + 0.3 * act);
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ks * 2.8);
      g.addColorStop(0, rgba(HOT, 0.95 * aK)); g.addColorStop(0.22, rgba(GOLD, 0.6 * aK));
      g.addColorStop(0.55, rgba(DEEP, 0.18 * aK)); g.addColorStop(1, rgba(DEEP, 0));
      ctx.fillStyle = g; circle(cx, cy, ks * 2.8); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(GOLD, 0.7 * aK);
      ctx.beginPath();
      for (let k = 0; k <= 3; k++) { const a = t * 0.9 + k * TAU / 3, x = cx + Math.cos(a) * ks * 1.5, y = cy + Math.sin(a) * ks * 1.5; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.setLineDash([2, 3]); ctx.strokeStyle = rgba(AMBER, 0.5 * aK);
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) { const a = -t * 0.5 + k * TAU / 6, x = cx + Math.cos(a) * ks * 2.1, y = cy + Math.sin(a) * ks * 2.1; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // ===== wake pulses =====
    state.pulses = state.pulses.filter(p0 => tn - p0 < 1.4);
    for (const p0 of state.pulses) {
      const age = (tn - p0) / 1.4;
      ctx.lineWidth = 2.2 * (1 - age) + 0.4;
      ctx.strokeStyle = rgba(GOLD, 0.6 * (1 - age) * (1 - age));
      circle(cx, cy, Math.min(R1, MIN) * (1.02 + age * 1.7)); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    drawHUD(tn);
  }

  // ---------- HUD (text only, no buttons) ----------
  const hud = { focus: 0, gauge: 0, label: null };
  function drawHUD(tn) {
    const fs = Math.round(clamp(MIN * 0.03, 10, 15));
    ctx.textBaseline = 'middle';

    // wordmark + status
    const by = H - Math.max(44, H * 0.075);
    ctx.textAlign = 'center';
    ctx.font = '600 ' + (fs + 2) + 'px ' + FONT;
    ctx.fillStyle = rgba(GOLD, 0.32 + 0.55 * state.act);
    ctx.fillText('K  A  I  V  R  A', CX, by - fs * 1.6);
    ctx.font = '400 ' + fs + 'px ' + FONT;
    let status, sa;
    if (state.active) { status = '● ONLINE'; sa = 0.85; }
    else if (!state.hintSeen) { status = 'TAP THE CORE'; sa = 0.25 + 0.2 * Math.sin(tn * 2.4); }
    else { status = '○ STANDBY'; sa = 0.28; }
    ctx.fillStyle = rgba(state.active ? HOT : AMBER, sa);
    ctx.fillText(status, CX, by);

    // focused layer readout (top-left) with leader line
    const L = focusLayer();
    hud.focus = lerp(hud.focus, L ? 1 : 0, 0.12);
    if (L) hud.label = L;
    if (hud.focus > 0.02 && hud.label) {
      const Lf = hud.label, idx = LAYERS.indexOf(Lf) + 1, a = hud.focus;
      const x = 22, y = Math.max(52, H * 0.085);
      ctx.textAlign = 'left';
      ctx.font = '400 ' + fs + 'px ' + FONT;
      ctx.fillStyle = rgba(AMBER, 0.55 * a);
      ctx.fillText('LAYER 0' + idx + ' / 0' + LAYERS.length, x, y);
      ctx.font = '600 ' + Math.round(fs * 1.7) + 'px ' + FONT;
      ctx.fillStyle = rgba(HOT, 0.92 * a);
      ctx.fillText(Lf.name, x, y + fs * 1.9);
      const nameW = ctx.measureText(Lf.name).width;
      ctx.font = '400 ' + fs + 'px ' + FONT;
      ctx.fillStyle = rgba(GOLD, 0.6 * a);
      ctx.fillText(Lf.info, x, y + fs * 3.6);
      const infoW = ctx.measureText(Lf.info).width;
      // leader: out from the name, down past the text, then to the layer's edge
      const Rl = silR(Lf.r), ex = clamp(CX - Rl * 0.707, 10, W - 10), ey = clamp(CY - Rl * 0.707, 10, H - 10);
      const sx = x + nameW + 12, sy = y + fs * 1.9, kx = Math.max(sx + 14, x + infoW + 14), ky = y + fs * 4.8;
      ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(GOLD, 0.45 * a);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(kx, sy); ctx.lineTo(kx, Math.max(ky, Math.min(ey, ky + 40))); ctx.lineTo(ex, Math.max(ey, ky)); ctx.stroke();
      ctx.fillStyle = rgba(HOT, 0.85 * a); circle(ex, Math.max(ey, ky), 2.2); ctx.fill();
    }

    // depth gauge (right edge) while zooming
    const want = (tn - state.lastZoom < 1.8 || cam.dist < 3.0) ? 1 : 0;
    hud.gauge = lerp(hud.gauge, want, 0.08);
    if (hud.gauge > 0.02) {
      const a = hud.gauge, gx = W - 18, y0 = H * 0.3, y1 = H * 0.66;
      const pos = dd => y0 + (y1 - y0) * (Math.log(DIST_MAX) - Math.log(dd)) / (Math.log(DIST_MAX) - Math.log(DIST_MIN));
      ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(AMBER, 0.35 * a);
      ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); ctx.stroke();
      ctx.textAlign = 'right'; ctx.font = '400 ' + Math.max(9, fs - 2) + 'px ' + FONT;
      LAYERS.forEach((Lx, i) => {
        const yy = pos(Math.min(Lx.hi, DIST_MAX));
        ctx.strokeStyle = rgba(GOLD, 0.6 * a);
        ctx.beginPath(); ctx.moveTo(gx - 6, yy); ctx.lineTo(gx, yy); ctx.stroke();
        ctx.fillStyle = rgba(AMBER, (hud.label === Lx && hud.focus > 0.5 ? 0.9 : 0.4) * a);
        ctx.fillText('0' + (i + 1), gx - 10, yy);
      });
      const my = pos(clamp(cam.dist, DIST_MIN, DIST_MAX));
      ctx.fillStyle = rgba(HOT, 0.95 * a);
      ctx.beginPath(); ctx.moveTo(gx + 1, my); ctx.lineTo(gx + 8, my - 4); ctx.lineTo(gx + 8, my + 4); ctx.closePath(); ctx.fill();
    }
  }

  state.pulses.push(now() + 0.4);
  requestAnimationFrame(frame);
})();
