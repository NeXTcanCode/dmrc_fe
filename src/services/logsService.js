import { api } from '../api/client';

export const getWalletLogs = async (type = 'all') => {
  const query = type === 'all' ? '' : `?type=${type}`;
  const { data } = await api.get(`/wallet/logs${query}`);
  return data;
};

export const manualClearLogs = async () => {
  const { data } = await api.delete('/wallet/logs');
  return data;
};

export const autoClearLogs = async () => {
  const { data } = await api.delete('/wallet/logs/auto-clear');
  return data;
};
