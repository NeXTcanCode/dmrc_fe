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
import { MAX_ACCEPTABLE_ACCURACY_M, initialTravelState, shouldAutoStop, step } from './travelTracker';

const TRIP_COOLDOWN_MS = 120000;
const TICK_MS = 15000;
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

const AUTO_STOP_KEY = 'dmrc.autoStopAfterTrip';
export const getAutoStopAfterTrip = () => {
  try {
    return localStorage.getItem(AUTO_STOP_KEY) !== '0';
  } catch {
    return true;
  }
};
export const setAutoStopAfterTrip = (on) => {
  try {
    localStorage.setItem(AUTO_STOP_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable - default (on) applies
  }
};

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

  try {
    const routeKm = await routeDistanceKm(from, to);
    const distanceKmAuto = Math.max(1, Number((routeKm ?? meters / 1000).toFixed(1)));
    await dispatch(
      addPendingTrip({
        boardingStationId: from.id,
        alightingStationId: to.id,
        boardingStationName: from.name,
        alightingStationName: to.name,
        distanceKm: distanceKmAuto,
        isSmartCard: true,
        travelDate: new Date().toISOString()
      })
    ).unwrap();
    dispatch(
      monitoringMessageSet(`Trip captured: ${distanceKmAuto} km from ${from.name} to ${to.name}.`)
    );
    await Promise.all([dispatch(fetchWallet()).unwrap(), dispatch(fetchTrips()).unwrap()]);
    return true;
  } catch (e) {
    lastCreatedAt = 0; // release the reservation so a later detection can retry
    dispatch(
      monitoringMessageSet(
        e?.response?.data?.message || e?.message || 'Auto trip creation failed'
      )
    );
    return false;
  }
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
  if (exitInfo && (travel.phase === 'idle' || travel.phase === 'at_station') && getAutoStopAfterTrip()) {
    const goodFix = fix && !(fix.accuracy > MAX_ACCEPTABLE_ACCURACY_M) ? fix : null;
    if (shouldAutoStop({ ...exitInfo, fix: goodFix, now: Date.now() })) {
      stopMonitoringWatch(dispatch);
      dispatch(
        monitoringMessageSet('Trip captured. Monitoring stopped - enable it again for your next ride.')
      );
      return;
    }
  }

  const { state, event } = step(travel, fix, Date.now(), trackedStations, isInterchange);
  const changed = state.phase !== travel.phase;
  travel = state;
  if (travel.phase === 'in_transit') exitInfo = null; // a new ride began
  if (changed || fix) saveTravel();

  updateJourney(dispatch, fix, event);

  if (event.type === 'stale_ride') {
    dispatch(
      missedRideSet({
        from: { id: event.from.id, name: event.from.name },
        leftAt: event.leftAt
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
  travel = { ...initialTravelState };
  lastCreatedAt = 0;
  exitInfo = null;
  saveTravel();
  dispatch(monitoringStopped());
};
