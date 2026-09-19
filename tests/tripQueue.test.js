import test from 'node:test';
import assert from 'node:assert/strict';
import { readQueue, enqueueTrip, writeQueue, isNetworkError } from '../src/services/tripQueue.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

test('queue starts empty and keeps trips in order', () => {
  const s = fakeStorage();
  assert.deepEqual(readQueue(s), []);
  enqueueTrip({ id: 1 }, s);
  enqueueTrip({ id: 2 }, s);
  assert.deepEqual(readQueue(s).map((t) => t.id), [1, 2]);
});

test('writing an empty queue clears it', () => {
  const s = fakeStorage();
  enqueueTrip({ id: 1 }, s);
  writeQueue([], s);
  assert.deepEqual(readQueue(s), []);
});

test('corrupt storage reads as an empty queue', () => {
  const s = { getItem: () => '{not json', setItem() {}, removeItem() {} };
  assert.deepEqual(readQueue(s), []);
});

test('network errors are recognised, server errors are not', () => {
  assert.equal(isNetworkError({ code: 'ERR_NETWORK' }), true);
  assert.equal(isNetworkError({ message: 'Network Error' }), true);
  assert.equal(isNetworkError({ message: 'Request failed with status code 400' }), false);
});
