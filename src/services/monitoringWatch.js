import { trackedStations } from '../data/trackedStations';
import { addPendingTrip } from '../features/tripsSlice';
import { fetchTrips } from '../features/tripsSlice';
import { fetchWallet } from '../features/walletSlice';
import {
  journeySet,
  locationDeniedSet,
  missedRideCleared,
  missedRideSet,
  monitoringMessageSet,
  monitoringStarted,
  monitoringStopped,
  nearestSet
} from '../features/monitoringSlice';
import { DMRC_STATION_CODES } from '../data/dmrcStationCodes';
import { getLines, getLineStations, planJourney } from './metroService';
import { corridorCheck, decideRide, durationCheck, parseDurationMin, routePolylines, speedCheck } from './rideValidation';
import { buildNetwork, inferLine, progressOnLine } from './journeyProgress';
import { distanceInMeters, findNearestStation } from './geolocationService';
import { MAX_ACCEPTABLE_ACCURACY_M, STATION_RADIUS_M, initialTravelState, sameStation, shouldAutoStop, step } from './travelTracker';
import { enqueueTrip, isNetworkError, readQueue, writeQueue } from './tripQueue';

const TRIP_COOLDOWN_MS = 120000;
const TICK_MS = 15000;
// No update for this long while a ride is open means the app was suspended
// (tab hidden, screen off), so elapsed time can no longer be trusted.
const SUSPEND_GAP_MS = 90000;
const STORAGE_KEY = 'dmrc.travelState';

// Module-level singleton: the watch and travel progress must survive
// Dashboard unmounting when the user switches tabs, so they can't live in
// component state/refs - only the on/off flag and status message go to Redux.
let watchId = null;
let tickId = null;
let travel = loadTravel();
let lastCreatedAt = 0;
let interchangeCodes = new Set();
let network = null;
// Which line/direction the rider is on; re-inferred after each interchange.
let ride = { originCode: null, line: null };
// Where the last recorded trip ended; used to switch monitoring off after the rider walks away.
let exitInfo = null;
let deniedReported = false;
let lastAdvanceAt = 0;
let needsReconcile = false;
let resumeInFlight = false;
let lastSeenStation = null; // last station the rider was actually seen at
let hiddenAt = null;
let wakeLock = null;
let dispatchRef = null;
let flushing = false;

const coordsByCode = Object.fromEntries(
  trackedStations.filter((s) => s.code).map((s) => [s.code, { lat: s.lat, lng: s.lng }])
);

const codeOf = (station) => station.code || DMRC_STATION_CODES[station.name];
const isInterchange = (station) => interchangeCodes.has(codeOf(station));

// Interchange flags come from the live line data; if it can't be loaded the
// tracker simply behaves as if no station is an interchange.
const loadInterchangeCodes = async () => {
  try {
    const lines = await getLines();
    const perLine = await Promise.all(
      (Array.isArray(lines) ? lines : lines?.lines || []).map((l) =>
        getLineStations(l.line_code).catch(() => [])
      )
    );
    const codes = new Set();
    perLine.flat().forEach((s) => {
      if (s?.interchange && s.station_code) codes.add(s.station_code);
    });
    interchangeCodes = codes;
    const stationsByLine = {};
    const lineList = Array.isArray(lines) ? lines : lines?.lines || [];
    lineList.forEach((l, i) => {
      stationsByLine[l.line_code] = perLine[i] || [];
    });
    network = buildNetwork(lineList, stationsByLine, coordsByCode);
  } catch {
    // keep whatever we had
  }
};

function loadTravel() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...initialTravelState, ...JSON.parse(raw) } : { ...initialTravelState };
  } catch {
    return { ...initialTravelState };
  }
}

// Rolling log of raw GPS fixes so real rides can be exported and used to tune thresholds.
const LOG_KEY = 'dmrc.gpsLog';
const LOG_MAX = 1500;

// Debug tools are off for normal users. Turn on with ?debug=1 in the URL (remembered
// in this browser) or ?debug=0 to turn off; always on in the dev server.
export const isDebugEnabled = () => {
  try {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '1') localStorage.setItem('dmrc.debug', '1');
    if (param === '0') localStorage.removeItem('dmrc.debug');
    return import.meta.env.DEV || localStorage.getItem('dmrc.debug') === '1';
  } catch {
    return false;
  }
};

const logFix = (position, phase) => {
  if (!isDebugEnabled()) return;
  try {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.push({
      t: new Date(position.timestamp || Date.now()).toISOString(),
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      acc: position.coords.accuracy,
      speed: position.coords.speed,
      phase
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
  } catch {
    // logging is best-effort
  }
};

export const downloadGpsLog = () => {
  try {
    const blob = new Blob([localStorage.getItem(LOG_KEY) || '[]'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gps-log-${new Date().toISOString().slice(0, 16)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    // ignore
  }
};

export const clearGpsLog = () => {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
};

const saveTravel = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(travel));
  } catch {
    // storage unavailable - tracking still works for this session
  }
};

const messageFor = (event) => {
  switch (event.type) {
    case 'poor_fix':
      return `Waiting for a better GPS fix (accuracy ±${Math.round(event.accuracy)}m)...`;
    case 'moving': {
      const m = Math.round(event.nearest.meters);
      const dist = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
      return `Monitoring on. Not at a station yet - ${event.nearest.station.name} is ${dist} away. Trip capture starts when you reach a station.`;
    }
    case 'boarding':
      return `At ${event.station.name}. Trip starts once you leave the station.`;
    case 'at_station':
      return `Still at ${event.station.name}. Monitoring continues.`;
    case 'signal_lost':
      return `Signal lost - travelling from ${event.from.name}. Fare will be added when signal returns.`;
    case 'in_transit':
      return `Travelling from ${event.from.name}...`;
    case 'interchange':
      return `At interchange ${event.at.name}. Continue your ride - one trip will be recorded when you finish.`;
    case 'stale_ride':
      return `Ride from ${event.from.name} was not completed - tell us where you got off.`;
    case 'rejected':
      return `Ignored ${event.from.name} to ${event.to.name}: movement did not look like a metro ride.`;
    default:
      return null;
  }
};

// Real route distance from the DMRC planner; null lets the caller fall back
// to the straight-line distance between the two stations.
const routeDistanceKm = async (from, to) => {
  const fromCode = codeOf(from);
  const toCode = codeOf(to);
  if (!fromCode || !toCode || fromCode === toCode) return null;
  try {
    const data = await planJourney(fromCode, toCode, 'least-distance');
    const km = data?.total_distance_km;
    return typeof km === 'number' && km > 0 ? km : null;
  } catch {
    return null;
  }
};

// Rejects rides that did not follow the metro line or took an unusual time.
// Never blocks a trip because data is missing (no planner, no coordinates).
const validateTrip = async (event) => {
  const fromCode = codeOf(event.from);
  const toCode = codeOf(event.to);
  if (!network || !fromCode || !toCode) return { ok: true };
  let plan;
  try {
    plan = await planJourney(fromCode, toCode, 'least-distance');
  } catch {
    return { ok: true };
  }
  const legs = Array.isArray(plan?.legs) ? plan.legs : [];
  const polylines = routePolylines(network, legs);
  const corridor = corridorCheck(event.fixes, polylines);
  const speed = speedCheck(event.fixes, polylines.flat());
  let duration = null;
  if (!event.endedAtInterchange && event.leftAt) {
    const elapsedMin = (Date.now() - event.leftAt) / 60000;
    const interchanges = Math.max(0, legs.length - 1);
    duration = durationCheck(elapsedMin, parseDurationMin(plan?.total_time), interchanges);
  }
  return decideRide({ corridor, duration, speed });
};

const createTrip = async (dispatch, from, to, meters) => {
  const now = Date.now();
  if (now - lastCreatedAt < TRIP_COOLDOWN_MS) return false;
  // Reserve the cooldown before the request goes out so a second update
  // while it is in flight can't create a duplicate pending trip.
  lastCreatedAt = now;

  let payload = null;
  try {
    const routeKm = await routeDistanceKm(from, to);
    const distanceKmAuto = Math.max(1, Number((routeKm ?? meters / 1000).toFixed(1)));
    payload = {
      boardingStationId: from.id,
      alightingStationId: to.id,
      boardingStationName: from.name,
      alightingStationName: to.name,
      distanceKm: distanceKmAuto,
      isSmartCard: true,
      travelDate: new Date().toISOString()
    };
    await dispatch(addPendingTrip(payload)).unwrap();
    dispatch(
      monitoringMessageSet(`Trip captured: ${distanceKmAuto} km from ${from.name} to ${to.name}.`)
    );
    await Promise.all([dispatch(fetchWallet()).unwrap(), dispatch(fetchTrips()).unwrap()]);
    return true;
  } catch (e) {
    if (payload && isNetworkError(e)) {
      // Offline: keep the trip and send it when the connection returns.
      enqueueTrip(payload);
      dispatch(
        monitoringMessageSet(
          `Offline - trip ${from.name} to ${to.name} saved and will be added when you are back online.`
        )
      );
      return true;
    }
    lastCreatedAt = 0; // release the reservation so a later detection can retry
    dispatch(
      monitoringMessageSet(
        e?.response?.data?.message || e?.message || 'Auto trip creation failed'
      )
    );
    return false;
  }
};

// Send trips saved while offline. Stops at the first network failure so order is kept.
const flushQueue = async (dispatch) => {
  if (flushing) return;
  flushing = true;
  try {
    const queue = readQueue();
    let i = 0;
    let sent = 0;
    for (; i < queue.length; i++) {
      try {
        await dispatch(addPendingTrip(queue[i])).unwrap();
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        // the server rejected this trip; drop it so it cannot block the rest
      }
    }
    writeQueue(queue.slice(i));
    if (sent > 0) {
      dispatch(monitoringMessageSet(`${sent} saved trip(s) added now that you are online.`));
      await Promise.all([dispatch(fetchWallet()).unwrap(), dispatch(fetchTrips()).unwrap()]).catch(() => {});
    }
  } finally {
    flushing = false;
  }
};

const openRide = () => travel.phase === 'in_transit' || travel.phase === 'interchange_wait';

// The app was suspended mid-ride. Elapsed time proves nothing, so look at where
// the rider is now and ask, instead of guessing that the ride ended or continued.
const reconcile = (dispatch, fix) => {
  const from = travel.station;
  if (!from) return;
  const nearest = findNearestStation(fix, trackedStations);
  const at = nearest && nearest.meters <= STATION_RADIUS_M ? nearest.station : null;
  const leftAt = travel.leftAt;
  const via = travel.via;

  travel = { ...initialTravelState };
  saveTravel();
  ride = { originCode: null, line: null };
  dispatch(journeySet(null));

  if (at && sameStation(at, from)) {
    dispatch(monitoringMessageSet(`Back at ${from.name}. The interrupted ride was discarded.`));
    return;
  }

  const lastSeen = via || (lastSeenStation && !sameStation(lastSeenStation, from) ? lastSeenStation : null);
  const pick = (st) => (st ? { id: st.id, name: st.name } : null);
  dispatch(
    missedRideSet({
      kind: at ? 'at_station' : 'away',
      from: pick(from),
      leftAt,
      suggestion: pick(at),
      lastSeen: pick(lastSeen)
    })
  );
  dispatch(
    monitoringMessageSet(
      at
        ? `Tracking was interrupted. You are at ${at.name} - did your ride from ${from.name} end here?`
        : `Tracking was interrupted. Tell us where you got off (ride from ${from.name}).`
    )
  );
};

const resumeCheck = (dispatch) => {
  if (!openRide() || resumeInFlight || !navigator.geolocation) return;
  resumeInFlight = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      resumeInFlight = false;
      if (!openRide() || !needsReconcile) return;
      if (typeof pos.coords.accuracy === 'number' && pos.coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
        dispatch(
          monitoringMessageSet(
            `Waiting for a better GPS fix (accuracy ±${Math.round(pos.coords.accuracy)}m) to check your ride...`
          )
        );
        return;
      }
      needsReconcile = false;
      reconcile(dispatch, { lat: pos.coords.latitude, lng: pos.coords.longitude });
    },
    () => {
      resumeInFlight = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
};

const requestWakeLock = async () => {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    wakeLock = null; // unsupported or denied - tracking still works while the tab is visible
  }
};

const releaseWakeLock = () => {
  try {
    wakeLock?.release();
  } catch {
    // ignore
  }
  wakeLock = null;
};

const onVisibilityChange = () => {
  if (!dispatchRef) return;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  requestWakeLock();
  flushQueue(dispatchRef);
  if (hiddenAt && Date.now() - hiddenAt > SUSPEND_GAP_MS && openRide()) {
    needsReconcile = true;
    resumeCheck(dispatchRef);
  }
  hiddenAt = null;
};

const onOnline = () => {
  if (dispatchRef) flushQueue(dispatchRef);
};

const updateJourney = (dispatch, fix, event) => {
  if (!network) return;
  if (travel.phase === 'interchange_wait' && event.type === 'interchange') {
    // Changing trains: the next leg starts from this station on an unknown line.
    ride = { originCode: codeOf(event.at), line: null };
    dispatch(journeySet(null));
    return;
  }
  if (travel.phase !== 'in_transit' || !fix) {
    if (travel.phase === 'idle' || travel.phase === 'at_station') {
      ride = { originCode: null, line: null };
      dispatch(journeySet(null));
    }
    return;
  }
  const originCode = ride.originCode || codeOf(travel.station);
  if (ride.originCode !== originCode) ride = { originCode, line: null };
  if (!ride.line) ride.line = inferLine(network, originCode, fix);
  if (!ride.line) return;
  const p = progressOnLine(network, ride.line.lineCode, ride.line.dir, originCode, fix);
  if (p) dispatch(journeySet(p));
};

const advance = (dispatch, fix) => {
  // Trip done and the rider has left the exit station: stop before the tracker
  // mistakes the walk away from the station for a new ride.
  if (exitInfo && (travel.phase === 'idle' || travel.phase === 'at_station')) {
    const goodFix = fix && !(fix.accuracy > MAX_ACCEPTABLE_ACCURACY_M) ? fix : null;
    if (shouldAutoStop({ ...exitInfo, fix: goodFix, now: Date.now() })) {
      stopMonitoringWatch(dispatch);
      dispatch(
        monitoringMessageSet('Trip captured. Monitoring stopped - enable it again for your next ride.')
      );
      return;
    }
  }

  const nowMs = Date.now();
  if (lastAdvanceAt && nowMs - lastAdvanceAt > SUSPEND_GAP_MS && openRide()) needsReconcile = true;
  lastAdvanceAt = nowMs;

  if (needsReconcile && openRide()) {
    if (fix && !(fix.accuracy > MAX_ACCEPTABLE_ACCURACY_M)) {
      needsReconcile = false;
      reconcile(dispatch, fix);
    } else if (!fix) {
      resumeCheck(dispatch);
    }
    return;
  }
  needsReconcile = false;

  const { state, event } = step(travel, fix, nowMs, trackedStations, isInterchange);
  const changed = state.phase !== travel.phase;
  travel = state;
  if (travel.phase === 'in_transit') exitInfo = null; // a new ride began
  if (changed || fix) saveTravel();

  updateJourney(dispatch, fix, event);

  if (event.type === 'stale_ride') {
    dispatch(
      missedRideSet({
        kind: 'stale',
        from: { id: event.from.id, name: event.from.name },
        leftAt: event.leftAt,
        suggestion: null,
        lastSeen: null
      })
    );
  }

  if (event.type === 'trip') {
    return validateTrip(event).then((v) =>
      v.ok
        ? createTrip(dispatch, event.from, event.to, event.meters).then((created) => {
            if (created) exitInfo = { exitStation: event.to, tripAt: Date.now() };
          })
        : dispatch(
            monitoringMessageSet(`Ignored ${event.from.name} to ${event.to.name}: ${v.reason}.`)
          )
    );
  }
  const msg = messageFor(event);
  if (msg) dispatch(monitoringMessageSet(msg));
};

const handlePosition = async (dispatch, position) => {
  if (deniedReported) {
    deniedReported = false;
    dispatch(locationDeniedSet(false));
  }
  logFix(position, travel.phase);
  const nearestStation = findNearestStation(
    { lat: position.coords.latitude, lng: position.coords.longitude },
    trackedStations
  );
  if (
    nearestStation &&
    nearestStation.meters <= STATION_RADIUS_M &&
    !(position.coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M)
  ) {
    lastSeenStation = nearestStation.station;
  }
  if (nearestStation) {
    dispatch(
      nearestSet({ name: nearestStation.station.name, meters: Math.round(nearestStation.meters) })
    );
  }
  await advance(dispatch, {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed
  });
};

// The user says where they got off a ride the tracker never saw finish.
export const createMissedTrip = async (dispatch, fromId, toId) => {
  const from = trackedStations.find((s) => s.id === fromId);
  const to = trackedStations.find((s) => s.id === toId);
  if (!from || !to) throw new Error('Station not found');
  if (from.id === to.id) throw new Error('Boarding and exit stations cannot be the same');
  lastCreatedAt = 0; // an explicit user action must not be blocked by the auto-capture cooldown
  const created = await createTrip(dispatch, from, to, distanceInMeters(from, to));
  if (created) dispatch(missedRideCleared());
  return created;
};

export const isMonitoringActive = () => watchId !== null;

export const startMonitoringWatch = (dispatch) => {
  if (!navigator.geolocation) {
    dispatch(monitoringMessageSet('Geolocation not supported in this browser'));
    return;
  }
  if (watchId !== null) return;
  loadInterchangeCodes();
  dispatchRef = dispatch;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);
  requestWakeLock();
  flushQueue(dispatch);

  watchId = navigator.geolocation.watchPosition(
    (position) =>
      handlePosition(dispatch, position).catch(() =>
        dispatch(monitoringMessageSet('Location processing failed'))
      ),
    (geoError) => {
      if (geoError.code === 1) {
        deniedReported = true;
        dispatch(locationDeniedSet(true));
      }
      dispatch(monitoringMessageSet(geoError.message || 'Unable to read location'));
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  // watchPosition goes silent underground, so a timer detects the gap.
  tickId = setInterval(() => advance(dispatch, null), TICK_MS);

  dispatch(monitoringStarted());
};

export const stopMonitoringWatch = (dispatch) => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (tickId !== null) {
    clearInterval(tickId);
    tickId = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('online', onOnline);
  releaseWakeLock();
  dispatchRef = null;
  needsReconcile = false;
  lastAdvanceAt = 0;
  lastSeenStation = null;
  travel = { ...initialTravelState };
  lastCreatedAt = 0;
  exitInfo = null;
  saveTravel();
  dispatch(monitoringStopped());
};
