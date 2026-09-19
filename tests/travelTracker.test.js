import test from 'node:test';
import assert from 'node:assert/strict';
import { step, initialTravelState, MAX_RIDE_MS, MAX_STORED_FIXES } from '../src/services/travelTracker.js';

const A = { id: 'A', name: 'A', lat: 28.5494, lng: 77.2001 };
const B = { id: 'B', name: 'B', lat: 28.56, lng: 77.207 };
const C = { id: 'C', name: 'C', lat: 28.57, lng: 77.214 };
const stations = [A, B, C];
const isInterchange = (s) => s.id === 'B';

const at = (s, extra = {}) => ({ lat: s.lat, lng: s.lng, accuracy: 10, ...extra });

// seq: [seconds, fix|null]; returns the list of event summaries
const run = (seq, interchange = () => false) => {
  let state = { ...initialTravelState };
  return seq.map(([t, fix]) => {
    const r = step(state, fix, t * 1000, stations, interchange);
    state = r.state;
    return r.event.type === 'trip' ? `trip:${r.event.from.id}>${r.event.to.id}` : r.event.type;
  });
};

test('short ride with a GPS gap creates one trip', () => {
  const ev = run([[0, at(A)], [5, at(A)], [100, null], [200, at(B)]]);
  assert.equal(ev.at(-1), 'trip:A>B');
});

test('passing an intermediate station at speed does not end the trip', () => {
  const ev = run([[0, at(A)], [30, at(B, { speed: 15 })], [600, at(C)], [650, at(C)]]);
  assert.deepEqual(ev.filter((e) => e.startsWith('trip')), ['trip:A>C']);
});

test('slow walk between stations is rejected', () => {
  const seq = [[0, at(A)]];
  for (let i = 1; i <= 40; i++) {
    const f = i / 40;
    seq.push([i * 30, { lat: A.lat + (B.lat - A.lat) * f, lng: A.lng + (B.lng - A.lng) * f, accuracy: 10, speed: 1.4 }]);
  }
  for (let i = 1; i <= 3; i++) seq.push([1200 + i * 30, at(B, { speed: 0 })]);
  const ev = run(seq);
  assert.ok(ev.includes('rejected'));
  assert.ok(!ev.some((e) => e.startsWith('trip')));
});

test('poor accuracy fixes are ignored', () => {
  assert.deepEqual(run([[0, at(A, { accuracy: 80 })]]), ['poor_fix']);
});

test('changing trains at an interchange yields one trip to the final station', () => {
  const ev = run(
    [[0, at(A)], [5, at(A)], [100, null], [200, at(B)], [230, at(B)], [250, at(B)], [300, at(B)], [420, at(B)], [500, null], [900, at(C)], [950, at(C)], [1000, at(C)]],
    (s) => isInterchange(s)
  );
  assert.deepEqual(ev.filter((e) => e.startsWith('trip')), ['trip:A>C']);
});

test('walking out of an interchange ends the trip there', () => {
  const ev = run(
    [[0, at(A)], [100, null], [200, at(B)], [230, at(B)], [300, at(B)], [330, { lat: 28.5615, lng: 77.2085, accuracy: 10, speed: 1.4 }], [360, { lat: 28.564, lng: 77.211, accuracy: 10, speed: 1.4 }]],
    (s) => isInterchange(s)
  );
  assert.equal(ev.at(-1), 'trip:A>B');
});

test('waiting at an interchange past the limit records the trip', () => {
  const ev = run([[0, at(A)], [100, null], [200, at(B)], [230, at(B)], [1200, null]], (s) => isInterchange(s));
  assert.equal(ev.at(-1), 'trip:A>B');
});

test('a fix near another station after the max ride time is stale, not a trip', () => {
  const late = MAX_RIDE_MS / 1000 + 600;
  const ev = run([[0, at(A)], [5, at(A)], [100, null], [late, at(C)], [late + 30, at(C)]]);
  assert.ok(ev.includes('stale_ride'));
  assert.ok(!ev.some((e) => e.startsWith('trip')));
});

test('a timer tick past the max ride time reports a stale ride', () => {
  const late = MAX_RIDE_MS / 1000 + 600;
  const ev = run([[0, at(A)], [5, at(A)], [100, null], [late, null]]);
  assert.equal(ev.at(-1), 'stale_ride');
});

test('a ride within the max time is unaffected', () => {
  const ev = run([[0, at(A)], [5, at(A)], [100, null], [3600, at(B)]]);
  assert.equal(ev.at(-1), 'trip:A>B');
});

test('trip events carry the fixes collected while travelling', () => {
  let state = { ...initialTravelState };
  let last;
  const seq = [[0, at(A)], [5, at(A)]];
  for (let i = 0; i < 400; i++) seq.push([100 + i * 6, { lat: 28.555, lng: 77.204, accuracy: 10, speed: 12 }]);
  seq.push([3000, at(C)]);
  for (const [t, fix] of seq) {
    const r = step(state, fix, t * 1000, stations, () => false);
    state = r.state;
    if (r.event.type === 'trip') last = r.event;
  }
  assert.ok(last, 'trip created');
  assert.ok(last.fixes.length > 0 && last.fixes.length <= MAX_STORED_FIXES);
  assert.ok(last.leftAt != null);
});
