import { api } from '../api/client';

export const getLines = async () => {
  const { data } = await api.get('/metro/lines');
  return data;
};

export const getLineStations = async (lineCode) => {
  const { data } = await api.get(`/metro/lines/${lineCode}/stations`);
  return data;
};

export const searchStations = async (query) => {
  const { data } = await api.get(`/metro/stations/search?q=${encodeURIComponent(query)}`);
  return data;
};

export const getStationDetail = async (code) => {
  const { data } = await api.get(`/metro/stations/${code}`);
  return data;
};

export const planJourney = async (fromCode, toCode, strategy = 'least-distance') => {
  const { data } = await api.get(
    `/metro/journeys/plan?from=${encodeURIComponent(fromCode)}&to=${encodeURIComponent(toCode)}&strategy=${strategy}`
  );
  return data;
};

export const getNotifications = async () => {
  const { data } = await api.get('/metro/notifications');
  return data;
};
