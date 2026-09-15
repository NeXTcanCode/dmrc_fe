import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/authSlice';
import walletReducer from '../features/walletSlice';
import tripsReducer from '../features/tripsSlice';
import monitoringReducer from '../features/monitoringSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    wallet: walletReducer,
    trips: tripsReducer,
    monitoring: monitoringReducer
  }
});
