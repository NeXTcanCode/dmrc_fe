import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { confirmTrip, createPendingTrip, deleteTrip, getTrips } from '../services/tripsService';

export const fetchTrips = createAsyncThunk('trips/fetch', async () => getTrips());
export const addPendingTrip = createAsyncThunk('trips/addPending', async (payload) => createPendingTrip(payload));
export const markTripConfirmed = createAsyncThunk('trips/confirm', async (id) => {
  try {
    return await confirmTrip(id);
  } catch (e) {
    // keep the server's message (e.g. insufficient balance) through the thunk's error serialisation
    throw new Error(e?.response?.data?.message || e?.message || 'Failed to confirm trip');
  }
});
export const removeTrip = createAsyncThunk('trips/remove', async (id) => {
  await deleteTrip(id);
  return id;
});

const tripsSlice = createSlice({
  name: 'trips',
  initialState: {
    items: [],
    loading: false,
    error: ''
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrips.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchTrips.fulfilled, (state, action) => {
        state.loading = false;
        state.error = '';
        state.items = action.payload;
      })
      .addCase(fetchTrips.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch trips';
      })
      .addCase(addPendingTrip.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to create trip';
      })
      .addCase(markTripConfirmed.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to confirm trip';
      })
      .addCase(removeTrip.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to delete trip';
      });
  }
});

export default tripsSlice.reducer;
