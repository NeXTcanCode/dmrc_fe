const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;

export const distanceInMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sa = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  return EARTH_RADIUS_M * c;
};

export const findNearestStation = (coords, stations) => {
  if (!stations.length) return null;

  let best = null;
  for (const station of stations) {
    if (typeof station.lat !== 'number' || typeof station.lng !== 'number') continue;
    const meters = distanceInMeters(coords, station);
    if (!best || meters < best.meters) {
      best = { station, meters };
    }
  }
  return best;
};
