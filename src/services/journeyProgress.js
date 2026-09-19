import { distanceInMeters } from './geolocationService';

const MIN_MOVE_M = 200; // need this much movement from the boarding station to infer a direction
const MIN_ALIGNMENT = 0.5; // cosine between movement and line direction

// lines: /metro/lines rows; stationsByLine: { lineCode: ordered [{station_code, station_name, interchange}] }
// coordsByCode: { code: {lat, lng} }
export const buildNetwork = (lines, stationsByLine, coordsByCode) => {
  const lineMeta = {};
  const lineIndex = {}; // stationCode -> [{ lineCode, idx }]
  lines.forEach((l) => {
    const stations = stationsByLine[l.line_code] || [];
    lineMeta[l.line_code] = {
      code: l.line_code,
      name: l.line_color || l.name,
      color: l.primary_color_code,
      stations: stations.map((s) => ({
        code: s.station_code,
        name: s.station_name,
        interchange: Boolean(s.interchange)
      }))
    };
    stations.forEach((s, idx) => {
      (lineIndex[s.station_code] ||= []).push({ lineCode: l.line_code, idx });
    });
  });
  return { lineMeta, lineIndex, coordsByCode };
};

const toXY = (origin, p) => ({
  x: distanceInMeters(origin, { lat: origin.lat, lng: p.lng }) * Math.sign(p.lng - origin.lng),
  y: distanceInMeters(origin, { lat: p.lat, lng: origin.lng }) * Math.sign(p.lat - origin.lat)
});

const cosine = (origin, a, b) => {
  const va = toXY(origin, a);
  const vb = toXY(origin, b);
  const na = Math.hypot(va.x, va.y);
  const nb = Math.hypot(vb.x, vb.y);
  if (!na || !nb) return 0;
  return (va.x * vb.x + va.y * vb.y) / (na * nb);
};

// Which line and direction is the rider on, judged from where they moved
// relative to the neighbouring stations of the boarding station. Returns
// { lineCode, dir } or null when it can't be told yet.
export const inferLine = (network, originCode, fix) => {
  const origin = network.coordsByCode[originCode];
  if (!origin || !fix || distanceInMeters(origin, fix) < MIN_MOVE_M) return null;

  let best = null;
  for (const { lineCode, idx } of network.lineIndex[originCode] || []) {
    const stations = network.lineMeta[lineCode].stations;
    for (const dir of [1, -1]) {
      const next = stations[idx + dir];
      const nextCoords = next && network.coordsByCode[next.code];
      if (!nextCoords) continue;
      const score = cosine(origin, fix, nextCoords);
      if (!best || score > best.score) best = { lineCode, dir, score };
    }
  }
  return best && best.score >= MIN_ALIGNMENT ? { lineCode: best.lineCode, dir: best.dir } : null;
};

// Next station and the next interchange ahead on the given line/direction.
export const progressOnLine = (network, lineCode, dir, originCode, fix) => {
  const line = network.lineMeta[lineCode];
  if (!line) return null;
  const stations = line.stations;
  const originIdx = stations.findIndex((s) => s.code === originCode);
  if (originIdx < 0) return null;

  // Nearest station on this line that is not behind the boarding station.
  let nearestIdx = originIdx;
  let nearestM = Infinity;
  stations.forEach((s, i) => {
    if ((i - originIdx) * dir < 0) return;
    const c = network.coordsByCode[s.code];
    if (!c || !fix) return;
    const m = distanceInMeters(c, fix);
    if (m < nearestM) {
      nearestM = m;
      nearestIdx = i;
    }
  });

  // Once the rider is beyond the nearest station (towards the one after it),
  // the next station is the one after.
  let aheadIdx = nearestIdx;
  const here = network.coordsByCode[stations[nearestIdx]?.code];
  const after = network.coordsByCode[stations[nearestIdx + dir]?.code];
  if (fix && here && after && cosine(here, fix, after) >= 0) aheadIdx = nearestIdx + dir;
  aheadIdx = Math.max(0, Math.min(stations.length - 1, aheadIdx));

  const next = stations[aheadIdx];
  const atTerminus = aheadIdx === (dir > 0 ? stations.length - 1 : 0);

  let interchange = null;
  for (let i = aheadIdx; i >= 0 && i < stations.length; i += dir) {
    if (!stations[i].interchange) continue;
    const others = (network.lineIndex[stations[i].code] || [])
      .map((e) => network.lineMeta[e.lineCode])
      .filter((l) => l.code !== lineCode && l.name !== line.name);
    interchange = {
      name: stations[i].name,
      stopsAway: Math.abs(i - aheadIdx),
      lines: [...new Map(others.map((l) => [l.name, { name: l.name, color: l.color }])).values()]
    };
    break;
  }

  return {
    lineName: line.name,
    lineColor: line.color,
    toward: stations[dir > 0 ? stations.length - 1 : 0].name,
    next: next.name,
    atTerminus,
    interchange
  };
};
