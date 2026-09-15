import { createSlice } from '@reduxjs/toolkit';

const monitoringSlice = createSlice({
  name: 'monitoring',
  initialState: {
    active: false,
    message: 'Travel monitoring is off'
  },
  reducers: {
    monitoringStarted(state) {
      state.active = true;
      state.message = 'Travel monitoring enabled. Move near stations to auto-capture trips.';
    },
    monitoringStopped(state) {
      state.active = false;
      state.message = 'Travel monitoring is off';
    },
    monitoringMessageSet(state, action) {
      state.message = action.payload;
    }
  }
});

export const { monitoringStarted, monitoringStopped, monitoringMessageSet } = monitoringSlice.actions;
export default monitoringSlice.reducer;
