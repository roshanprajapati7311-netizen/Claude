/* Mounts the Kaivra core full-screen and connects it to the Android app (vibration). */
(function () {
  'use strict';
  const ACCENT = '#4FD8C4'; // the design's colour; other options in the design: #FFB13B amber, #FF8A1F orange, #B98CFF violet
  const native = window.KaivraNative || null;
  const $ = (id) => document.getElementById(id);
  const btn = $('core-btn'), cv = $('cv');

  const comp = new Component({ accent: ACCENT });
  let V = comp.renderVals();
  V.canvasRef(cv);

  comp._paint = function () {
    V = comp.renderVals();
    document.documentElement.style.setProperty('--accent', V.accent);
    $('state').textContent = V.stateLabel;
    $('bars').style.display = V.active ? 'flex' : 'none';
    btn.setAttribute('aria-pressed', V.activeAttr);
    btn.setAttribute('aria-label', V.coreLabel);
    $('card').style.display = V.hasSel ? 'block' : 'none';
    $('hint').style.display = V.noSel ? 'block' : 'none';
    $('sel-layer').textContent = V.selLayer;
    $('sel-name').textContent = V.selName;
    $('sel-desc').textContent = V.selDesc;
    $('hintA').textContent = V.hintA;
    $('hintB').textContent = V.hintB;
  };

  // haptic tick when Kaivra wakes or goes back to standby
  const toggle = comp._toggle.bind(comp);
  comp._toggle = function () {
    toggle();
    try { if (native && native.vibrate) native.vibrate(comp._activeT ? 28 : 12); else if (navigator.vibrate) navigator.vibrate(comp._activeT ? 28 : 12); } catch (e) {}
  };

  btn.addEventListener('pointerdown', (e) => V.onDown(e));
  btn.addEventListener('pointermove', (e) => V.onMove(e));
  btn.addEventListener('pointerup', (e) => V.onUp(e));
  btn.addEventListener('pointercancel', (e) => V.onUp(e));
  btn.addEventListener('wheel', (e) => { e.preventDefault(); V.onWheel(e); }, { passive: false });
  btn.addEventListener('click', (e) => V.onClick(e));
  btn.addEventListener('keydown', (e) => V.onKey(e));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  comp._paint();
  comp._mounted = true;
  comp.componentDidMount();
  window.KaivraCore = comp;
})();
