const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let lastCSSW = window.innerWidth;
let lastCSSH = window.innerHeight;
let lastDPR  = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const newCSSW = window.innerWidth;
  const newCSSH = window.innerHeight;

  const dpr = Math.max(1, window.devicePixelRatio || 1);

  if (state.points && state.points.length > 0) {
    const sx = newCSSW / lastCSSW;
    const sy = newCSSH / lastCSSH;

    if (isFinite(sx) && isFinite(sy) && (sx !== 1 || sy !== 1)) {
      for (const p of state.points) {
        p.x *= sx;
        p.y *= sy;
      }
    }
  }

  canvas.width = Math.floor(newCSSW * dpr);
  canvas.height = Math.floor(newCSSH * dpr);
  canvas.style.width = newCSSW + "px";
  canvas.style.height = newCSSH + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  lastCSSW = newCSSW;
  lastCSSH = newCSSH;
  lastDPR = dpr;

  render();
}
window.addEventListener("resize", resizeCanvas);

// =======================
// 2) State + UI
// =======================
const UI = {
  pointsSlider: document.getElementById("pointsSlider"),
  pointsValue: document.getElementById("pointsValue"),

  samplesSlider: document.getElementById("samplesSlider"),
  samplesValue: document.getElementById("samplesValue"),

  tSlider: document.getElementById("tSlider"),
  tValue: document.getElementById("tValue"),

  toggleGridBtn: document.getElementById("toggleGridBtn"),
  toggleConstructionBtn: document.getElementById("toggleConstructionBtn"),
  toggleElevatedBtn: document.getElementById("toggleElevatedBtn"),
  toggleIntermediateBtn: document.getElementById("toggleIntermediateBtn"),
  resetBtn: document.getElementById("resetBtn"),

  kInput: document.getElementById("kInput"),
  elevateOnceBtn: document.getElementById("elevateOnceBtn"),
  resetKBtn: document.getElementById("resetKBtn"),

  degreeInfo: document.getElementById("degreeInfo"),
};

const state = {
  showGrid: true,
  showConstruction: false,
  showIntermediate: false,
  showElevated: true,

  t: 0.5,
  samples: parseInt(UI.samplesSlider.value, 10),

  pointsCount: parseInt(UI.pointsSlider.value, 10),
  points: [],

  k: parseInt(UI.kInput.value, 10),

  dragging: {
    active: false,
    index: -1,
    offsetX: 0,
    offsetY: 0
  }
};

const CFG = {
  hitRadius: 12,

  pointRadius: 7,
  elevatedPointRadius: 4,

  polygonWidth: 2.2,
  curveWidth: 3.0,
  elevatedPolygonWidth: 2.0,
  elevatedCurveWidth: 3.0,

  constructionWidth: 1.6,

  gridThinWidth: 1,
  gridThickWidth: 1.4,
  maxRings: 7,
  radialLines: 12
};

// =======================
// 3) Helpers
// =======================
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function center() {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(A, B, t) {
  return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t) };
}

function addWeighted(A, wA, B, wB) {
  return { x: A.x * wA + B.x * wB, y: A.y * wA + B.y * wB };
}

function generatePoints(count) {
  const c = center();
  const baseR = Math.min(window.innerWidth, window.innerHeight) * 0.33;

  const pts = [];
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count - Math.PI / 2;
    const wobble = 0.78 + 0.35 * Math.sin(i * 1.7);
    const r = baseR * wobble;
    pts.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
  }
  return pts;
}

// =======================
// 4) de Casteljau (point + construction)
// =======================
function deCasteljauWithLevels(ctrlPts, t) {
  const levels = [];
  let current = ctrlPts.map(p => ({ x: p.x, y: p.y }));
  levels.push(current);

  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(lerpPoint(current[i], current[i + 1], t));
    }
    levels.push(next);
    current = next;
  }

  return { point: current[0], levels };
}

function computeCurve(ctrlPts, samples) {
  const poly = [];
  if (ctrlPts.length < 2) return poly;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const { point } = deCasteljauWithLevels(ctrlPts, t);
    poly.push(point);
  }
  return poly;
}

// =======================
// 5) Degree Elevation
// =======================
function elevateOnce(ctrlPts) {
  const n = ctrlPts.length - 1;
  if (n < 1) return ctrlPts.map(p => ({ x: p.x, y: p.y }));

  const Q = new Array(n + 2);
  Q[0] = { x: ctrlPts[0].x, y: ctrlPts[0].y };
  Q[n + 1] = { x: ctrlPts[n].x, y: ctrlPts[n].y };

  for (let i = 1; i <= n; i++) {
    const alpha = i / (n + 1);
    Q[i] = addWeighted(ctrlPts[i - 1], alpha, ctrlPts[i], 1 - alpha);
  }
  return Q;
}

function elevateK(ctrlPts, k) {
  let result = ctrlPts.map(p => ({ x: p.x, y: p.y }));
  const times = Math.max(0, Math.floor(k));
  for (let i = 0; i < times; i++) {
    result = elevateOnce(result);
  }
  return result;
}

// =======================
// 6) Drawing helpers
// =======================
function clear() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.restore();
}

function drawPolarGrid() {
  const c = center();
  const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.45;

  ctx.setLineDash([6, 10]);

  for (let i = 1; i <= CFG.maxRings; i++) {
    const r = (maxR * i) / CFG.maxRings;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);

    const isMajor = (i % 2 === 0);
    ctx.strokeStyle = isMajor
      ? "rgba(140,170,220,0.10)"
      : "rgba(140,170,220,0.05)";
    ctx.lineWidth = isMajor ? CFG.gridThickWidth : CFG.gridThinWidth;
    ctx.stroke();
  }

  ctx.setLineDash([]);

  const SPOKES = 8;

  for (let k = 0; k < SPOKES; k++) {
    const ang = (Math.PI * 2 * k) / SPOKES;
    const x2 = c.x + maxR * Math.cos(ang);
    const y2 = c.y + maxR * Math.sin(ang);

    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(x2, y2);

    ctx.strokeStyle = "rgba(140,170,220,0.06)";
    ctx.lineWidth = CFG.gridThinWidth;
    ctx.stroke();
  }

  // ---------- MAIN AXES (X and Y highlighted) ----------
  ctx.beginPath();
  ctx.moveTo(c.x - maxR, c.y);
  ctx.lineTo(c.x + maxR, c.y);
  ctx.moveTo(c.x, c.y - maxR);
  ctx.lineTo(c.x, c.y + maxR);

  ctx.strokeStyle = "rgba(160,190,230,0.18)";
  ctx.lineWidth = CFG.gridThickWidth + 0.5;
  ctx.stroke();
}

function drawPolyline(pts, strokeStyle, lineWidth) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawMarker(p, radius, fillStyle, strokeStyle) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

function drawControlPoints(pts) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];

    let fill = "#ffd400"; 
    if (i === 0) fill = "#4cff4c"; 
    if (i === pts.length - 1) fill = "#ff3b3b"; 

    drawMarker(p, CFG.pointRadius, fill, "rgba(0,0,0,0.35)");
  }
}

function drawElevatedPoints(pts) {
  for (let i = 0; i < pts.length; i++) {
    drawMarker(
      pts[i],
      CFG.elevatedPointRadius,
      "rgba(180,220,255,0.55)",
      "rgba(0,0,0,0.25)"
    );
  }
}

function drawConstruction(levels) {
  for (let lvl = 1; lvl < levels.length; lvl++) {
    const pts = levels[lvl];

    drawPolyline(pts, "rgba(255,170,60,0.55)", CFG.constructionWidth);

    for (let i = 0; i < pts.length; i++) {
      drawMarker(pts[i], 4, "rgba(255,170,60,0.75)", "rgba(0,0,0,0.25)");
    }
  }
}

// =======================
// 7) Render
// =======================
function render() {
  clear();

  if (state.showGrid) drawPolarGrid();

  // --- Original control polygon + curve
  drawPolyline(state.points, "rgba(255,255,255,0.92)", CFG.polygonWidth);
  ctx.lineJoin = (state.samples <= 25) ? "miter" : "round";
  ctx.lineCap  = (state.samples <= 25) ? "butt"  : "round";
  const curve = computeCurve(state.points, state.samples);
  drawPolyline(curve, "rgb(255,0,220)", 3.0);

  // t-point for original + (optional) construction
  const { point: bt, levels } = deCasteljauWithLevels(state.points, state.t);
  if (state.showConstruction) drawConstruction(levels);
  drawMarker(bt, 6, "rgba(0,170,255,0.9)", "rgba(0,0,0,0.35)");

  // --- Elevated (degree n+k)
  if (state.showElevated) {
    const polys = [];
    polys.push(state.points.map(p => ({ x: p.x, y: p.y })));

    for (let step = 1; step <= state.k; step++) {
      polys.push(elevateOnce(polys[step - 1]));
    }

    const elevatedPts = polys[polys.length - 1];

    if (state.showIntermediate && state.k >= 2) {
      for (let step = 1; step <= state.k - 1; step++) {
        const pts = polys[step];

        drawPolyline(pts, "rgba(0,220,255,0.22)", 1.4);

        for (let i = 0; i < pts.length; i++) {
          drawMarker(pts[i], 3, "rgba(0,220,255,0.35)", "rgba(0,0,0,0.16)");
        }   
      }
    }

    drawPolyline(elevatedPts, "rgba(80,190,255,0.85)", CFG.elevatedPolygonWidth);
    drawElevatedPoints(elevatedPts);

    const elevatedCurve = computeCurve(elevatedPts, state.samples);
    ctx.save();
    ctx.setLineDash([6, 6]);
    drawPolyline(elevatedCurve, "rgba(0,150,255,0.75)", 2.0);
    ctx.restore();

    const { point: et } = deCasteljauWithLevels(elevatedPts, state.t);
    drawMarker(et, 5, "rgba(0,120,220,0.85)", "rgba(0,0,0,0.35)");
  }

  const n = state.points.length - 1;
  const nk = n + state.k;
  UI.degreeInfo.textContent = `Degree: n = ${n}, elevated = n + k = ${nk}`;

  drawControlPoints(state.points);

  if (state.k < 2) {
  UI.toggleIntermediateBtn.textContent = "Show Intermediates";
  UI.toggleIntermediateBtn.classList.remove("on");
  state.showIntermediate = false;
}

}

// =======================
// 8) Mouse events (drag points)
// =======================
function pickPointIndex(mx, my) {
  const r2 = CFG.hitRadius * CFG.hitRadius;
  let best = -1;
  let bestD2 = Infinity;

  for (let i = 0; i < state.points.length; i++) {
    const p = state.points[i];
    const d2 = dist2(mx, my, p.x, p.y);
    if (d2 <= r2 && d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

canvas.addEventListener("mousedown", (e) => {
  const m = getMousePos(e);
  const idx = pickPointIndex(m.x, m.y);
  if (idx === -1) return;

  state.dragging.active = true;
  state.dragging.index = idx;

  const p = state.points[idx];
  state.dragging.offsetX = p.x - m.x;
  state.dragging.offsetY = p.y - m.y;
});

window.addEventListener("mousemove", (e) => {
  if (!state.dragging.active) return;
  const m = getMousePos(e);

  const idx = state.dragging.index;
  const p = state.points[idx];

  p.x = m.x + state.dragging.offsetX;
  p.y = m.y + state.dragging.offsetY;

  const pad = 10;
  p.x = clamp(p.x, pad, window.innerWidth - pad);
  p.y = clamp(p.y, pad, window.innerHeight - pad);

  render();
});

window.addEventListener("mouseup", () => {
  state.dragging.active = false;
  state.dragging.index = -1;
});

// =======================
// 9) UI events
// =======================
UI.pointsSlider.addEventListener("input", () => {
  state.pointsCount = parseInt(UI.pointsSlider.value, 10);
  UI.pointsValue.textContent = String(state.pointsCount);
  state.points = generatePoints(state.pointsCount);
  render();
});

UI.samplesSlider.addEventListener("input", () => {
  state.samples = parseInt(UI.samplesSlider.value, 10);
  UI.samplesValue.textContent = String(state.samples);
  render();
});

UI.tSlider.addEventListener("input", () => {
  state.t = parseFloat(UI.tSlider.value);
  UI.tValue.textContent = state.t.toFixed(2);
  render();
});

UI.toggleGridBtn.addEventListener("click", () => {
  state.showGrid = !state.showGrid;
  UI.toggleGridBtn.textContent = state.showGrid ? "Hide Grid" : "Show Grid";
  render();
});

UI.toggleConstructionBtn.addEventListener("click", () => {
  state.showConstruction = !state.showConstruction;

  // If construction is shown, hide intermediates to avoid clutter
  if (state.showConstruction) {
    state.showIntermediate = false;
    UI.toggleIntermediateBtn.textContent = "Show Intermediates";
    UI.toggleIntermediateBtn.classList.remove("on");
  }

  UI.toggleConstructionBtn.textContent = state.showConstruction ? "Hide Construction" : "Show Construction";
  UI.toggleConstructionBtn.classList.toggle("on", state.showConstruction);

  render();
});

UI.toggleElevatedBtn.addEventListener("click", () => {
  state.showElevated = !state.showElevated;
  UI.toggleElevatedBtn.textContent = state.showElevated ? "Hide Elevated" : "Show Elevated";
  UI.toggleElevatedBtn.classList.toggle("on", state.showElevated);
  render();
});

UI.toggleIntermediateBtn.addEventListener("click", () => {
// No intermediates exist for k < 2 -> do nothing (and don't affect construction)
  if (state.k < 2) {
    state.showIntermediate = false;
    UI.toggleIntermediateBtn.textContent = "Show Intermediates";
    UI.toggleIntermediateBtn.classList.remove("on");
    render();
    return;
  }

  state.showIntermediate = !state.showIntermediate;

  // If intermediates are shown, hide construction to avoid clutter
  if (state.showIntermediate) {
    state.showConstruction = false;
    UI.toggleConstructionBtn.textContent = "Show Construction";
    UI.toggleConstructionBtn.classList.remove("on");
  }

  UI.toggleIntermediateBtn.textContent = state.showIntermediate ? "Hide Intermediates" : "Show Intermediates";
  UI.toggleIntermediateBtn.classList.toggle("on", state.showIntermediate);

  render();
});

UI.resetBtn.addEventListener("click", () => {
  state.points = generatePoints(state.pointsCount);
  render();
});

UI.kInput.addEventListener("input", () => {
  const v = parseInt(UI.kInput.value, 10);
  state.k = Number.isFinite(v) ? clamp(v, 0, 12) : 0;
  UI.kInput.value = String(state.k);
  render();
});

UI.elevateOnceBtn.addEventListener("click", () => {
  state.k = clamp(state.k + 1, 0, 12);
  UI.kInput.value = String(state.k);
  render();
});

UI.resetKBtn.addEventListener("click", () => {
  state.k = 0;
  UI.kInput.value = "0";
  render();
});

// =======================
// 10) Init
// =======================
function init() {
  UI.pointsValue.textContent = String(state.pointsCount);
  UI.samplesValue.textContent = String(state.samples);
  UI.tValue.textContent = state.t.toFixed(2);

  UI.toggleConstructionBtn.classList.toggle("on", state.showConstruction);
  UI.toggleElevatedBtn.classList.toggle("on", state.showElevated);

  UI.toggleIntermediateBtn.textContent = state.showIntermediate ? "Hide Intermediates" : "Show Intermediates";
  UI.toggleIntermediateBtn.classList.toggle("on", state.showIntermediate);

  state.points = generatePoints(state.pointsCount);
  resizeCanvas();
}
init();

setInterval(() => {
  const dprNow = Math.max(1, window.devicePixelRatio || 1);
  if (dprNow !== lastDPR) {
    resizeCanvas();
  }
}, 250);