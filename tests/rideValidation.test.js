import test from 'node:test';
import assert from 'node:assert/strict';
import {
  corridorCheck, durationCheck, parseDurationMin, routePolylines, distanceToSegment
} from '../src/services/rideValidation.js';

const line = [{ lat: 28.5, lng: 77.2 }, { lat: 28.52, lng: 77.2 }, { lat: 28.54, lng: 77.2 }];
const along = (n, lngOffset = 0) =>
  Array.from({ length: n }, (_, i) => ({ lat: 28.5 + (0.04 * i) / (n - 1), lng: 77.2 + lngOffset, t: i }));

test('fixes along the line pass the corridor check', () => {
  assert.equal(corridorCheck(along(10), [line]).ok, true);
});

test('fixes ~900 m off the line fail', () => {
  assert.equal(corridorCheck(along(10, 0.009), [line]).ok, false);
});

test('too few fixes or no route data pass', () => {
  assert.equal(corridorCheck(along(3, 0.02), [line]).ok, true);
  assert.equal(corridorCheck(along(10, 0.02), []).ok, true);
});

test('distanceToSegment measures across the segment', () => {
  const d = distanceToSegment({ lat: 28.51, lng: 77.2045 }, line[0], line[1]);
  assert.ok(d > 400 && d < 600);
});

test('duration within range passes, too fast and too slow fail', () => {
  assert.equal(durationCheck(20, 20).ok, true);
  assert.equal(durationCheck(5, 20).ok, false);
  assert.equal(durationCheck(90, 20).ok, false);
  assert.equal(durationCheck(NaN, 20).ok, true);
});

test('interchanges extend the allowed time', () => {
  assert.equal(durationCheck(75, 20, 0).ok, false);
  assert.equal(durationCheck(75, 20, 2).ok, true);
});

test('parseDurationMin handles h:mm and h:mm:ss', () => {
  assert.equal(parseDurationMin('1:05'), 65);
  assert.equal(parseDurationMin('0:30:30'), 30.5);
  assert.ok(Number.isNaN(parseDurationMin('abc')));
});

test('routePolylines builds coordinates between the leg stations', () => {
  const network = {
    lineMeta: { L1: { stations: [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }, { code: 'C', name: 'Gamma' }] } },
    coordsByCode: { A: line[0], B: line[1], C: line[2] }
  };
  const p = routePolylines(network, [{ from_station: 'ALPHA', to_station: 'gamma' }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].length, 3);
});

// ---- speed check + combined decision ----
import { speedCheck, decideRide } from '../src/services/rideValidation.js';

const M_PER_DEG = 110540;
// profile: [seconds, metresPerSecond]; fixes every 5 s along a north-going line
const fixesFrom = (profile, startT = 0) => {
  const fixes = [{ lat: 28.5, lng: 77.2, t: startT }];
  let d = 0;
  let t = startT;
  for (const [secs, v] of profile) {
    for (let s = 0; s < secs; s += 5) {
      d += v * 5;
      t += 5000;
      fixes.push({ lat: 28.5 + d / M_PER_DEG, lng: 77.2, t });
    }
  }
  return fixes;
};
const at = (m) => ({ lat: 28.5 + m / M_PER_DEG, lng: 77.2 });

test('metro-like ride (fast cruising, stops at stations) is not road-like', () => {
  // stop 25 s at 0, cruise ~1.2 km at 20 m/s, stop 25 s, repeat
  const profile = [[25, 0], [60, 20], [25, 0], [60, 20], [25, 0], [60, 20], [25, 0]];
  const fixes = fixesFrom(profile);
  const stations = [at(0), at(1200), at(2400), at(3600)];
  const r = speedCheck(fixes, stations);
  assert.equal(r.skipped, undefined);
  assert.equal(r.ok, true);
  assert.ok(r.metro > r.cab);
});

test('cab-like ride (slow, stops far from stations) is road-like', () => {
  const profile = [];
  for (let i = 0; i < 8; i++) profile.push([30, 9], [12, 0]); // ~32 km/h, 12 s stops at lights
  const fixes = fixesFrom(profile);
  const r = speedCheck(fixes, [at(0), at(9000)]);
  assert.equal(r.ok, false);
  assert.ok(r.cab >= 3);
});

test('too little data skips the speed check', () => {
  const r = speedCheck(fixesFrom([[30, 15]]), [at(0), at(500)]);
  assert.equal(r.skipped, true);
  assert.equal(r.ok, true);
});

test('a GPS gap mid-ride counts as metro evidence', () => {
  const a = fixesFrom([[100, 10]]);
  const b = fixesFrom([[100, 10]], a[a.length - 1].t + 120000).map((f) => ({ ...f, lat: f.lat + 0.02 }));
  const r = speedCheck([...a, ...b], [at(0), at(9000)]);
  assert.equal(r.signals.gap, true);
});

test('decision needs two failing checks, or an extreme track failure', () => {
  const bad = { ok: false };
  assert.equal(decideRide({ corridor: { ok: false, fraction: 0.6 }, duration: { ok: true }, speed: { ok: true } }).ok, true);
  assert.equal(decideRide({ corridor: { ok: false, fraction: 0.6 }, duration: bad, speed: { ok: true } }).ok, false);
  assert.equal(decideRide({ corridor: { ok: true }, duration: bad, speed: bad }).ok, false);
  assert.equal(decideRide({ corridor: { ok: false, fraction: 0.9 }, duration: null, speed: { ok: true } }).ok, false);
  assert.equal(decideRide({ corridor: { ok: true }, duration: null, speed: { ok: true, skipped: true } }).ok, true);
});
