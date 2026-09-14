import { api } from '../api/client';

export const getTrips = async () => {
  const { data } = await api.get('/trips');
  return data;
};

export const createPendingTrip = async (payload) => {
  const { data } = await api.post('/trips/pending', payload);
  return data;
};

export const confirmTrip = async (id) => {
  const { data } = await api.put(`/trips/${id}/confirm`);
  return data;
};

export const deleteTrip = async (id) => {
  const { data } = await api.delete(`/trips/${id}`);
  return data;
};
