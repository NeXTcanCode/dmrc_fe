// Checks run when a ride ends, to reject rides that were not on the metro
// (cab, bike, bus). Thresholds are placeholders until tuned on real ride logs.
export const CORRIDOR_M = 300;
export const MAX_OFF_TRACK_FRACTION = 0.5;
export const MIN_FIXES = 5;
export const MIN_TIME_RATIO = 0.5;
export const MAX_TIME_RATIO = 3;
export const INTERCHANGE_ALLOWANCE_MIN = 10;

// Local flat projection in metres around `origin`; fine at metro-segment scale.
const project = (origin, p) => ({
  x: (p.lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180),
  y: (p.lat - origin.lat) * 110540
});

export const distanceToSegment = (p, a, b) => {
  const pp = project(a, p);
  const bb = project(a, b);
  const len2 = bb.x * bb.x + bb.y * bb.y;
  const t = len2 ? Math.max(0, Math.min(1, (pp.x * bb.x + pp.y * bb.y) / len2)) : 0;
  return Math.hypot(pp.x - t * bb.x, pp.y - t * bb.y);
};

const distanceToPolylines = (p, polylines) => {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]));
    }
  }
  return best;
};

// Did the GPS fixes stay near the metro line(s) of the planned route?
// Passes when there is too little data to judge.
export const corridorCheck = (fixes, polylines) => {
  const usable = polylines.filter((l) => l.length >= 2);
  if (!fixes || fixes.length < MIN_FIXES || usable.length === 0) return { ok: true };
  const off = fixes.filter((f) => distanceToPolylines(f, usable) > CORRIDOR_M).length;
  const fraction = off / fixes.length;
  return { ok: fraction <= MAX_OFF_TRACK_FRACTION, fraction };
};

// "1:05" or "1:05:30" (h:m[:s]) -> minutes, or NaN.
export const parseDurationMin = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const parts = value.split(':').map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return NaN;
  return parts[0] * 60 + parts[1] + (parts[2] || 0) / 60;
};

// Is the ride time plausible for the planned journey time? Passes if unknown.
export const durationCheck = (elapsedMin, plannedMin, interchanges = 0) => {
  if (!Number.isFinite(elapsedMin) || !Number.isFinite(plannedMin) || plannedMin <= 0) return { ok: true };
  const min = plannedMin * MIN_TIME_RATIO;
  const max = plannedMin * MAX_TIME_RATIO + interchanges * INTERCHANGE_ALLOWANCE_MIN;
  return { ok: elapsedMin >= min && elapsedMin <= max, min, max };
};

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Turn planner legs ({from_station, to_station}) into coordinate polylines using
// the line/station order data. Legs that cannot be matched are skipped.
export const routePolylines = (network, legs) => {
  const result = [];
  for (const leg of legs || []) {
    const from = norm(leg.from_station);
    const to = norm(leg.to_station);
    for (const line of Object.values(network.lineMeta)) {
      const names = line.stations.map((s) => norm(s.name));
      const i = names.indexOf(from);
      const j = names.indexOf(to);
      if (i < 0 || j < 0) continue;
      const coords = line.stations
        .slice(Math.min(i, j), Math.max(i, j) + 1)
        .map((s) => network.coordsByCode[s.code])
        .filter(Boolean);
      if (coords.length >= 2) result.push(coords);
      break;
    }
  }
  return result;
};

// ---- Speed evidence -------------------------------------------------------
// Speed is a supporting signal, not a rule: a cab on an expressway can be as
// fast as the metro. It only counts against a ride when the road-like evidence
// clearly outweighs the metro-like evidence. Thresholds are placeholders.
export const FAST_KMH = 60;
export const FAST_MIN_S = 20;
export const STOP_KMH = 2;
export const STOP_MIN_S = 15;
export const STOP_MAX_S = 45;
export const OFF_STOP_MIN_S = 10;
export const STATION_STOP_M = 150;
export const OFF_STATION_M = 300;
export const MOVING_KMH = 20;
export const STOP_GO_PER_KM = 1.5;
export const HARSH_ACCEL_MS2 = 2.5;
export const MAX_SAMPLE_GAP_S = 15;
export const MIN_SPEED_FIXES = 20;
export const MIN_MOVING_S = 180;
export const GPS_GAP_S = 60;
export const ROAD_MARGIN = 3;

const metres = (a, b) => {
  const p = project(a, b);
  return Math.hypot(p.x, p.y);
};

// Smoothed speeds (m/s) between consecutive sampled fixes; pairs further
// apart than MAX_SAMPLE_GAP_S are skipped (that is a GPS gap, not a speed).
const speedSamples = (fixes) => {
  const raw = [];
  for (let i = 1; i < fixes.length; i++) {
    const dt = (fixes[i].t - fixes[i - 1].t) / 1000;
    if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
    raw.push({ i, t0: fixes[i - 1].t, t1: fixes[i].t, dt, v: metres(fixes[i - 1], fixes[i]) / dt });
  }
  // 3-sample moving average to damp GPS jitter
  return raw.map((s, k) => {
    const win = raw.slice(Math.max(0, k - 1), k + 2);
    return { ...s, v: win.reduce((a, b) => a + b.v, 0) / win.length };
  });
};

const runsOf = (samples, predicate) => {
  const runs = [];
  let cur = null;
  for (const s of samples) {
    if (predicate(s)) {
      if (cur && cur.lastI === s.i - 1) {
        cur.end = s.t1;
        cur.lastI = s.i;
      } else {
        cur = { start: s.t0, end: s.t1, lastI: s.i, firstI: s.i };
        runs.push(cur);
      }
    } else {
      cur = null;
    }
  }
  return runs.map((r) => ({ ...r, seconds: (r.end - r.start) / 1000 }));
};

// vertices: route station coordinates. Returns { ok, skipped, metro, cab, signals }.
export const speedCheck = (fixes, vertices) => {
  if (!fixes || fixes.length < MIN_SPEED_FIXES || !vertices || vertices.length === 0) {
    return { ok: true, skipped: true };
  }
  const samples = speedSamples(fixes);
  const movingS = samples.filter((s) => s.v * 3.6 > STOP_KMH).reduce((a, s) => a + s.dt, 0);
  if (movingS < MIN_MOVING_S) return { ok: true, skipped: true };

  const nearestVertexM = (p) => Math.min(...vertices.map((v) => metres(v, p)));

  const fast = runsOf(samples, (s) => s.v * 3.6 >= FAST_KMH).some((r) => r.seconds >= FAST_MIN_S);
  let gap = false;
  for (let i = 1; i < fixes.length; i++) {
    if ((fixes[i].t - fixes[i - 1].t) / 1000 >= GPS_GAP_S) gap = true;
  }

  const stops = runsOf(samples, (s) => s.v * 3.6 < STOP_KMH);
  let stationStops = 0;
  let offStops = 0;
  for (const st of stops) {
    const p = fixes[st.firstI - 1];
    const d = nearestVertexM(p);
    if (st.seconds >= STOP_MIN_S && st.seconds <= STOP_MAX_S && d <= STATION_STOP_M) stationStops++;
    else if (st.seconds >= OFF_STOP_MIN_S && d > OFF_STATION_M) offStops++;
  }

  let cycles = 0;
  let stopped = false;
  for (const s of samples) {
    const kmh = s.v * 3.6;
    if (kmh < 5) stopped = true;
    else if (kmh > MOVING_KMH && stopped) {
      cycles++;
      stopped = false;
    }
  }
  let km = 0;
  for (let i = 1; i < fixes.length; i++) {
    if ((fixes[i].t - fixes[i - 1].t) / 1000 <= MAX_SAMPLE_GAP_S) km += metres(fixes[i - 1], fixes[i]) / 1000;
  }
  const stopGo = cycles >= 3 && km > 0 && cycles / km >= STOP_GO_PER_KM;

  let harsh = 0;
  for (let k = 1; k < samples.length; k++) {
    if (samples[k].i - samples[k - 1].i === 1 && Math.abs(samples[k].v - samples[k - 1].v) / samples[k].dt > HARSH_ACCEL_MS2) harsh++;
  }

  const metro = (fast ? 2 : 0) + (gap ? 3 : 0) + Math.min(stationStops, 3);
  const cab = Math.min(offStops, 3) * 2 + (stopGo ? 1 : 0) + (harsh >= 3 ? 1 : 0);
  return {
    ok: cab - metro < ROAD_MARGIN,
    metro,
    cab,
    signals: { fast, gap, stationStops, offStops, stopGo, harsh }
  };
};

// ---- Combined decision ----------------------------------------------------
// A real ride wrongly rejected costs more than a cab ride wrongly accepted
// (pending trips can be deleted), so reject only when the checks agree.
export const EXTREME_OFF_TRACK = 0.8;

export const decideRide = ({ corridor, duration, speed }) => {
  const failures = [];
  if (corridor && corridor.ok === false) failures.push('the ride did not follow the metro line');
  if (duration && duration.ok === false) failures.push('the ride took an unusual amount of time');
  if (speed && speed.ok === false) failures.push('the speed pattern looked like a road ride');
  const extreme = corridor && corridor.ok === false && corridor.fraction >= EXTREME_OFF_TRACK;
  if (failures.length >= 2 || extreme) return { ok: false, reason: failures.join(' and ') };
  return { ok: true };
};
