// Trips that could not be sent because the phone was offline. They are kept in
// localStorage and retried when the connection returns, so a tunnel or a bad
// signal at the exit station cannot lose a captured trip.
const KEY = 'dmrc.tripQueue';

const store = (storage) => storage || (typeof localStorage !== 'undefined' ? localStorage : null);

export const readQueue = (storage) => {
  try {
    const raw = store(storage)?.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const writeQueue = (list, storage) => {
  try {
    const s = store(storage);
    if (!s) return;
    if (list.length) s.setItem(KEY, JSON.stringify(list));
    else s.removeItem(KEY);
  } catch {
    // storage unavailable - queue is best-effort
  }
};

export const enqueueTrip = (payload, storage) => {
  const list = readQueue(storage);
  list.push(payload);
  writeQueue(list, storage);
  return list.length;
};

// Errors raised by the network layer (no server answer), not by the server.
export const isNetworkError = (e) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  e?.code === 'ERR_NETWORK' ||
  /network error|failed to fetch/i.test(e?.message || '');
