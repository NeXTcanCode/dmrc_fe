import { createSlice } from '@reduxjs/toolkit';

const MISSED_KEY = 'dmrc.missedRide';
const loadMissedRide = () => {
  try {
    return JSON.parse(localStorage.getItem(MISSED_KEY) || 'null');
  } catch {
    return null;
  }
};
const saveMissedRide = (value) => {
  try {
    if (value) localStorage.setItem(MISSED_KEY, JSON.stringify(value));
    else localStorage.removeItem(MISSED_KEY);
  } catch {
    // storage unavailable
  }
};

const monitoringSlice = createSlice({
  name: 'monitoring',
  initialState: {
    active: false,
    message: 'Travel monitoring is off',
    missedRide: loadMissedRide(), // { from: {id, name}, leftAt } awaiting the user's exit station
    locationDenied: false,
    nearest: null, // { name, meters } from the latest GPS fix
    journey: null // { lineName, lineColor, toward, next, interchange } while riding
  },
  reducers: {
    monitoringStarted(state) {
      state.active = true;
      state.message = 'Travel monitoring enabled. Move near stations to auto-capture trips.';
    },
    monitoringStopped(state) {
      state.active = false;
      state.message = 'Travel monitoring is off';
      state.journey = null;
      state.nearest = null;
    },
    missedRideSet(state, action) {
      state.missedRide = action.payload;
      saveMissedRide(action.payload);
    },
    missedRideCleared(state) {
      state.missedRide = null;
      saveMissedRide(null);
    },
    locationDeniedSet(state, action) {
      state.locationDenied = action.payload;
    },
    nearestSet(state, action) {
      state.nearest = action.payload;
    },
    journeySet(state, action) {
      state.journey = action.payload;
    },
    monitoringMessageSet(state, action) {
      state.message = action.payload;
    }
  }
});

export const { monitoringStarted, monitoringStopped, monitoringMessageSet, journeySet, nearestSet, locationDeniedSet, missedRideSet, missedRideCleared } = monitoringSlice.actions;
export default monitoringSlice.reducer;
