import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { debitWallet, getWallet, rechargeWallet, updateWallet } from '../services/walletService';

export const fetchWallet = createAsyncThunk('wallet/fetch', async () => getWallet());
export const saveWallet = createAsyncThunk('wallet/save', async (balance) => updateWallet(balance));
export const addRecharge = createAsyncThunk('wallet/recharge', async ({ amount, mode }) => rechargeWallet(amount, mode));
export const deductAmount = createAsyncThunk('wallet/debit', async ({ amount }) => debitWallet(amount));

const walletSlice = createSlice({
  name: 'wallet',
  initialState: {
    currentBalance: 0,
    pendingDeduction: 0,
    availableBalance: 0,
    loading: false,
    error: ''
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchWallet.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchWallet.fulfilled, (state, action) => {
        state.loading = false;
        state.error = '';
        state.currentBalance = action.payload.currentBalance;
        state.pendingDeduction = action.payload.pendingDeduction;
        state.availableBalance = action.payload.availableBalance;
      })
      .addCase(fetchWallet.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch wallet';
      })
      .addCase(saveWallet.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to update wallet';
      })
      .addCase(addRecharge.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to recharge wallet';
      })
      .addCase(deductAmount.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to debit wallet';
      });
  }
});

export default walletSlice.reducer;
