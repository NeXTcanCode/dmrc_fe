import { distanceInMeters, findNearestStation } from './geolocationService.js';

export const STATION_RADIUS_M = 80;
export const MAX_ACCEPTABLE_ACCURACY_M = 50;
export const LEAVE_DISTANCE_M = 300;
export const LEAVE_SPEED_MS = 15 / 3.6;
export const GPS_GAP_MS = 60000;
export const DWELL_MS = 45000;
export const MAX_SPEED_MS = 80 / 3.6;
export const MIN_AVG_SPEED_MS = 10 / 3.6;
export const INTERCHANGE_WAIT_MS = 15 * 60000;
export const FIX_SAMPLE_MS = 5000;
export const MAX_STORED_FIXES = 300;
export const MAX_RIDE_MS = 5 * 60 * 60000;
const DWELL_MAX_SPEED_MS = 2;

export const initialTravelState = {
  phase: 'idle', // idle -> at_station -> in_transit -> [interchange_wait ->] (trip) -> idle
  station: null,
  lastFixAt: 0,
  leftAt: null,
  gapSeen: false,
  dwellStationId: null,
  dwellSince: null,
  via: null, // interchange station where the ride may continue
  viaAt: null,
  fixes: [] // sampled good fixes while travelling, for the route checks
};

// Interchange stations appear once per line with different ids but the same
// coordinates; treat those as one physical station.
const sameStation = (a, b) => a.id === b.id || distanceInMeters(a, b) < STATION_RADIUS_M * 2;

const addFix = (fixes = [], fix, now) => {
  const last = fixes[fixes.length - 1];
  if (last && now - last.t < FIX_SAMPLE_MS) return fixes;
  return [...fixes, { lat: fix.lat, lng: fix.lng, t: now }].slice(-MAX_STORED_FIXES);
};

const atStation = (station, now) => ({
  ...initialTravelState,
  phase: 'at_station',
  station,
  lastFixAt: now
});

const enterTransit = (state, leftAt) => ({
  ...state,
  phase: 'in_transit',
  leftAt,
  dwellStationId: null,
  dwellSince: null
});

// Pure state machine. `fix` is null for a timer tick with no GPS update.
// Returns { state, event } where event is one of:
// idle | poor_fix | moving | boarding | at_station | signal_lost | in_transit | interchange | trip | rejected | stale_ride
// `isInterchange(station)` marks stations where the user may change trains; arriving
// there holds the trip until the ride ends, so a ride with a change of trains is
// recorded as one trip from the boarding station to the final station. The route
// through the interchange comes from the journey planner, not from this file.
export const step = (state, fix, now, stations, isInterchange = () => false) => {
  // A ride whose arrival was never seen must not be ended by a much later fix.
  const rideStart = state.phase === 'in_transit' ? state.leftAt : state.phase === 'interchange_wait' ? state.leftAt ?? state.viaAt : null;
  if (rideStart != null && now - rideStart > MAX_RIDE_MS) {
    return {
      state: { ...initialTravelState },
      event: { type: 'stale_ride', from: state.station, leftAt: rideStart }
    };
  }

  if (!fix) {
    if (state.phase === 'interchange_wait' && now - state.viaAt > INTERCHANGE_WAIT_MS) {
      return {
        state: { ...initialTravelState },
        event: {
          type: 'trip', from: state.station, to: state.via, meters: distanceInMeters(state.station, state.via),
          fixes: state.fixes, leftAt: state.leftAt, endedAtInterchange: true
        }
      };
    }
    if (state.phase === 'at_station' && now - state.lastFixAt > GPS_GAP_MS) {
      return {
        state: { ...enterTransit(state, state.lastFixAt), gapSeen: true },
        event: { type: 'signal_lost', from: state.station }
      };
    }
    if (state.phase === 'in_transit' && !state.gapSeen && now - state.lastFixAt > GPS_GAP_MS) {
      return { state: { ...state, gapSeen: true }, event: { type: 'signal_lost', from: state.station } };
    }
    return { state, event: { type: 'idle' } };
  }

  if (typeof fix.accuracy === 'number' && fix.accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
    return { state, event: { type: 'poor_fix', accuracy: fix.accuracy } };
  }

  const nearest = findNearestStation(fix, stations);
  if (!nearest) return { state, event: { type: 'idle' } };
  const near = nearest.meters <= STATION_RADIUS_M;
  const speed = typeof fix.speed === 'number' ? fix.speed : 0;
  const gapBeforeFix = state.lastFixAt && now - state.lastFixAt > GPS_GAP_MS;

  // A long silence after the last fix near the boarding station means the
  // user went underground; treat the boarding as committed.
  let current = { ...state, lastFixAt: now };
  if (current.phase === 'at_station' && gapBeforeFix) {
    current = { ...enterTransit(current, state.lastFixAt), gapSeen: true };
  } else if (current.phase === 'in_transit' && gapBeforeFix) {
    current = { ...current, gapSeen: true };
  }

  if (current.phase === 'in_transit') {
    current = { ...current, fixes: addFix(current.fixes, fix, now) };
  }

  if (current.phase === 'interchange_wait') {
    const via = current.via;
    const awayVia = distanceInMeters(via, fix);
    const nearVia = awayVia <= STATION_RADIUS_M;
    const continuing =
      speed > LEAVE_SPEED_MS ||
      (near && !sameStation(nearest.station, via)) ||
      (gapBeforeFix && !nearVia);
    if (continuing) {
      // Changed trains: same origin, ride continues from the interchange.
      const resumed = {
        ...current,
        phase: 'in_transit',
        via: null,
        viaAt: null,
        gapSeen: current.gapSeen || Boolean(gapBeforeFix)
      };
      return step(resumed, fix, now, stations, isInterchange);
    }
    if (awayVia > LEAVE_DISTANCE_M) {
      // Walked out of the interchange station: the ride really ended there.
      return {
        state: { ...initialTravelState },
        event: {
          type: 'trip', from: current.station, to: via, meters: distanceInMeters(current.station, via),
          fixes: current.fixes, leftAt: current.leftAt, endedAtInterchange: true
        }
      };
    }
    return { state: current, event: { type: 'interchange', at: via } };
  }

  if (current.phase === 'idle') {
    if (!near) return { state: current, event: { type: 'moving', nearest } };
    return { state: atStation(nearest.station, now), event: { type: 'boarding', station: nearest.station } };
  }

  if (current.phase === 'at_station') {
    const away = distanceInMeters(current.station, fix);
    if (away > LEAVE_DISTANCE_M || speed > LEAVE_SPEED_MS) {
      return { state: enterTransit(current, now), event: { type: 'in_transit', from: current.station } };
    }
    return { state: current, event: { type: 'at_station', station: current.station } };
  }

  // in_transit
  if (!near || speed > DWELL_MAX_SPEED_MS) {
    return {
      state: { ...current, dwellStationId: null, dwellSince: null },
      event: { type: 'in_transit', from: current.station, nearest }
    };
  }

  const dest = nearest.station;
  if (sameStation(dest, current.station)) {
    // Came back to where it started without a plausible ride: start over here.
    return { state: atStation(dest, now), event: { type: 'at_station', station: dest } };
  }

  const dwellSince = current.dwellStationId === dest.id ? current.dwellSince : now;
  const arrived = current.gapSeen || now - dwellSince >= DWELL_MS;
  if (!arrived) {
    return {
      state: { ...current, dwellStationId: dest.id, dwellSince },
      event: { type: 'in_transit', from: current.station, nearest }
    };
  }

  const meters = distanceInMeters(current.station, dest);
  const elapsedS = Math.max(1, (now - current.leftAt) / 1000);
  const tooFast = meters / elapsedS > MAX_SPEED_MS;
  const tooSlow = !current.gapSeen && meters / elapsedS < MIN_AVG_SPEED_MS;
  if (tooFast || tooSlow) {
    return { state: atStation(dest, now), event: { type: 'rejected', from: current.station, to: dest } };
  }

  if (isInterchange(dest)) {
    return {
      state: { ...current, phase: 'interchange_wait', via: dest, viaAt: now, dwellStationId: null, dwellSince: null },
      event: { type: 'interchange', at: dest }
    };
  }

  return {
    state: { ...initialTravelState },
    event: { type: 'trip', from: current.station, to: dest, meters, fixes: current.fixes, leftAt: current.leftAt }
  };
};
