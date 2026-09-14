import { api } from '../api/client';

export const getWallet = async () => {
  const { data } = await api.get('/wallet');
  return data;
};

export const updateWallet = async (currentBalance) => {
  const { data } = await api.put('/wallet', { currentBalance });
  return data;
};

export const rechargeWallet = async (amount, mode = 'online') => {
  const { data } = await api.post('/wallet/recharge', { amount, mode });
  return data;
};

export const debitWallet = async (amount) => {
  const { data } = await api.post('/wallet/debit', { amount });
  return data;
};
