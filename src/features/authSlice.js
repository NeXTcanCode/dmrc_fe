import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { login as loginApi, register as registerApi } from '../services/authService';
import { setAuthToken } from '../api/client';

const tokenFromStorage = localStorage.getItem('token') || '';
const userFromStorage = (() => {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
})();

if (tokenFromStorage) setAuthToken(tokenFromStorage);

export const login = createAsyncThunk('auth/login', async (payload) => loginApi(payload));
export const register = createAsyncThunk('auth/register', async (payload) => registerApi(payload));

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: tokenFromStorage,
    user: userFromStorage,
    loading: false,
    error: ''
  },
  reducers: {
    logout(state) {
      state.token = '';
      state.user = null;
      setAuthToken('');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.token = action.payload.accessToken;
        state.user = action.payload.user;
        setAuthToken(action.payload.accessToken);
        localStorage.setItem('token', action.payload.accessToken);
        localStorage.setItem('user', JSON.stringify(action.payload.user));
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Login failed';
      })
      .addCase(register.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(register.fulfilled, (state, action) => {
        state.loading = false;
        state.token = action.payload.accessToken;
        state.user = action.payload.user;
        setAuthToken(action.payload.accessToken);
        localStorage.setItem('token', action.payload.accessToken);
        localStorage.setItem('user', JSON.stringify(action.payload.user));
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Register failed';
      });
  }
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
