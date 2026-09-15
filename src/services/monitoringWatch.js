import { geoStations } from '../data/stations';
import { addPendingTrip } from '../features/tripsSlice';
import { fetchTrips } from '../features/tripsSlice';
import { fetchWallet } from '../features/walletSlice';
import {
  monitoringMessageSet,
  monitoringStarted,
  monitoringStopped
} from '../features/monitoringSlice';
import { distanceInMeters, findNearestStation } from './geolocationService';

const STATION_RADIUS_M = 120;
const MIN_TRAVEL_MINUTES = 5;
const MAX_ACCEPTABLE_ACCURACY_M = 100;

// Module-level singleton: the watch and travel progress must survive
// Dashboard unmounting when the user switches tabs, so they can't live in
// component state/refs - only the on/off flag and status message go to Redux.
let watchId = null;
let travelState = {
  boardedStation: null,
  boardedAt: null,
  lastCreatedAt: 0
};

const handlePosition = async (dispatch, position) => {
  const accuracy = position.coords.accuracy;
  if (typeof accuracy === 'number' && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
    dispatch(
      monitoringMessageSet(
        `Waiting for a better GPS fix (accuracy ±${Math.round(accuracy)}m)...`
      )
    );
    return;
  }

  const coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };
  const nearest = findNearestStation(coords, geoStations);
  if (!nearest) return;

  if (nearest.meters > STATION_RADIUS_M) {
    dispatch(
      monitoringMessageSet(
        `Moving. Nearest station: ${nearest.station.name} (${Math.round(nearest.meters)}m)`
      )
    );
    return;
  }

  const now = Date.now();

  if (!travelState.boardedStation) {
    travelState.boardedStation = nearest.station;
    travelState.boardedAt = now;
    dispatch(
      monitoringMessageSet(
        `Boarding detected at ${nearest.station.name}. Waiting for destination...`
      )
    );
    return;
  }

  if (travelState.boardedStation.id === nearest.station.id) {
    dispatch(
      monitoringMessageSet(`Still at ${nearest.station.name}. Monitoring continues.`)
    );
    return;
  }

  const tripMinutes = (now - travelState.boardedAt) / 60000;
  if (tripMinutes < MIN_TRAVEL_MINUTES) {
    dispatch(
      monitoringMessageSet(
        `Detected ${nearest.station.name}. Waiting minimum ${MIN_TRAVEL_MINUTES} min trip window.`
      )
    );
    return;
  }

  if (now - travelState.lastCreatedAt < 120000) return;

  // Reserve the cooldown before the request goes out, not after it resolves,
  // so a second watchPosition update while the request is in flight can't
  // also pass the cooldown check and create a duplicate pending trip.
  travelState.lastCreatedAt = now;

  const meters = distanceInMeters(travelState.boardedStation, nearest.station);
  const distanceKmAuto = Math.max(1, Number((meters / 1000).toFixed(1)));
  const fromStationName = travelState.boardedStation.name;
  const toStationName = nearest.station.name;

  try {
    await dispatch(
      addPendingTrip({
        boardingStationId: travelState.boardedStation.id,
        alightingStationId: nearest.station.id,
        boardingStationName: fromStationName,
        alightingStationName: toStationName,
        distanceKm: distanceKmAuto,
        isSmartCard: true,
        travelDate: new Date().toISOString()
      })
    ).unwrap();

    travelState.boardedStation = nearest.station;
    travelState.boardedAt = now;

    dispatch(
      monitoringMessageSet(
        `Trip captured: ${distanceKmAuto} km from ${fromStationName} to ${toStationName}.`
      )
    );
    await Promise.all([dispatch(fetchWallet()).unwrap(), dispatch(fetchTrips()).unwrap()]);
  } catch (e) {
    travelState.lastCreatedAt = 0; // release the reservation so the next detection can retry
    dispatch(
      monitoringMessageSet(
        e?.response?.data?.message || e?.message || 'Auto trip creation failed'
      )
    );
  }
};

export const isMonitoringActive = () => watchId !== null;

export const startMonitoringWatch = (dispatch) => {
  if (!navigator.geolocation) {
    dispatch(monitoringMessageSet('Geolocation not supported in this browser'));
    return;
  }
  if (watchId !== null) return;

  watchId = navigator.geolocation.watchPosition(
    (position) =>
      handlePosition(dispatch, position).catch(() =>
        dispatch(monitoringMessageSet('Location processing failed'))
      ),
    (geoError) =>
      dispatch(monitoringMessageSet(geoError.message || 'Unable to read location')),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  dispatch(monitoringStarted());
};

export const stopMonitoringWatch = (dispatch) => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  travelState = { boardedStation: null, boardedAt: null, lastCreatedAt: 0 };
  dispatch(monitoringStopped());
};
