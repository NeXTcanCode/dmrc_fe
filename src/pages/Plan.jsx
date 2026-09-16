import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { stationOptions } from '../data/stations';
import { DMRC_STATION_CODES } from '../data/dmrcStationCodes';
import { getMapData, planJourney } from '../services/metroService';

const plannableStations = stationOptions
  .filter((s) => DMRC_STATION_CODES[s.name])
  .sort((a, b) => a.name.localeCompare(b.name));

const MAP_PADDING = 40;
const STATION_RADIUS = 3;
const INTERCHANGE_RADIUS = 6;
const ROUTE_STATION_RADIUS = 5;
const ENDPOINT_RADIUS = 9;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const GREY_LINE = '#ccd5e3';
const GREY_STATION = '#a9b4c8';
const PANEL_BG = '#f6f9fd';
const MAP_FONT = "'Manrope', sans-serif";

const normalizeName = (n) => (n || '').trim().toUpperCase();

export default function Plan() {
  const [fromName, setFromName] = useState(plannableStations[0]?.name || '');
  const [toName, setToName] = useState(plannableStations[1]?.name || '');
  const [strategy, setStrategy] = useState('least-distance');
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);

  const fromCode = useMemo(() => DMRC_STATION_CODES[fromName], [fromName]);
  const toCode = useMemo(() => DMRC_STATION_CODES[toName], [toName]);

  const [mapData, setMapData] = useState(null);

  useEffect(() => {
    getMapData()
      .then(setMapData)
      .catch(() => setMapData(null));
  }, []);

  const mapGeometry = useMemo(() => {
    if (!mapData) return null;
    const stationByCode = Object.fromEntries(
      mapData.stations
        .filter((s) => typeof s.x_coords === 'number' && typeof s.y_coords === 'number')
        .map((s) => [s.station_code, s])
    );
    const coords = Object.values(stationByCode);
    if (!coords.length) return null;

    const minX = Math.min(...coords.map((s) => s.x_coords));
    const maxX = Math.max(...coords.map((s) => s.x_coords));
    const minY = Math.min(...coords.map((s) => s.y_coords));
    const maxY = Math.max(...coords.map((s) => s.y_coords));

    const width = maxX - minX + MAP_PADDING * 2;
    const height = maxY - minY + MAP_PADDING * 2;
    const project = (s) => ({
      x: s.x_coords - minX + MAP_PADDING,
      y: s.y_coords - minY + MAP_PADDING,
    });
    const nameToCode = Object.fromEntries(
      coords.map((s) => [normalizeName(s.station_name), s.station_code])
    );
    const lineByLabel = Object.fromEntries(mapData.lines.map((l) => [l.line_color, l]));

    return { stationByCode, nameToCode, lineByLabel, width, height, project };
  }, [mapData]);

  // Resolves each leg's real from/to stations against the line's ordered
  // station list, so the highlighted segment includes every intermediate
  // station - not just the leg's two endpoints.
  const routeHighlight = useMemo(() => {
    if (!journey || !mapData || !mapGeometry) return null;
    const { nameToCode, lineByLabel } = mapGeometry;

    const segments = [];
    for (const leg of journey.legs || []) {
      const line = lineByLabel[leg.line_name];
      const fromCodeLeg = nameToCode[normalizeName(leg.from_station)];
      const toCodeLeg = nameToCode[normalizeName(leg.to_station)];
      if (!line || !fromCodeLeg || !toCodeLeg) continue;

      const order = mapData.stationsByLine[line.line_code] || [];
      const fromIdx = order.indexOf(fromCodeLeg);
      const toIdx = order.indexOf(toCodeLeg);
      if (fromIdx === -1 || toIdx === -1) continue;

      const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      segments.push({
        line_code: line.line_code,
        color: line.primary_color_code,
        codes: order.slice(lo, hi + 1),
      });
    }
    if (!segments.length) return null;

    const routeCodes = new Set(segments.flatMap((s) => s.codes));
    const startCode = nameToCode[normalizeName(journey.from)] || segments[0]?.codes[0];
    const endCode =
      nameToCode[normalizeName(journey.to)] || segments[segments.length - 1]?.codes.slice(-1)[0];

    return { segments, routeCodes, startCode, endCode };
  }, [journey, mapData, mapGeometry]);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Number((z + ZOOM_STEP).toFixed(2))));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Number((z - ZOOM_STEP).toFixed(2))));
  const zoomReset = () => setZoom(1);

  const onPlan = async (e) => {
    e.preventDefault();
    if (!fromCode || !toCode) return;
    if (fromCode === toCode) {
      setError('Boarding and destination stations cannot be the same.');
      return;
    }
    setLoading(true);
    setError('');
    setJourney(null);
    setZoom(1);
    try {
      const data = await planJourney(fromCode, toCode, strategy);
      setJourney(data);
    } catch (e2) {
      setError(e2?.response?.data?.message || e2?.message || 'Could not plan journey');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="section-head">
        <h2>Journey Planner</h2>
        <p>Real DMRC route, timing and fare between two stations.</p>
      </div>

      <form onSubmit={onPlan} className="manual-grid">
        <select value={fromName} onChange={(e) => setFromName(e.target.value)}>
          {plannableStations.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={toName} onChange={(e) => setToName(e.target.value)}>
          {plannableStations.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          <option value="least-distance">Least distance</option>
          <option value="minimum-interchange">Minimum interchange</option>
        </select>
        <button type="submit" className="primary manual-submit">
          Plan Journey
        </button>
      </form>

      {loading && <p style={{ marginTop: '12px' }}>Planning...</p>}
      {error && <small className="error">{error}</small>}

      {journey && (
        <div className="feature-card" style={{ padding: '14px', marginTop: '14px' }}>
          <div className="metrics-grid">
            <div className="metric-card">
              <h3>Total Time</h3>
              <strong>{journey.total_time}</strong>
            </div>
            <div className="metric-card">
              <h3>Distance</h3>
              <strong>{journey.total_distance_km} km</strong>
            </div>
            <div className="metric-card">
              <h3>Stations</h3>
              <strong>{journey.station_count}</strong>
            </div>
            <div className="metric-card">
              <h3>Fare</h3>
              <strong>INR {journey.fare?.applicable ?? journey.fare?.normal}</strong>
            </div>
          </div>

          <div className="list" style={{ marginTop: '14px' }}>
            {journey.legs?.map((leg, idx) => (
              <div key={idx} className="trip-row">
                <div>
                  <strong style={{ color: leg.line_color }}>{leg.line_name}</strong>
                  <p>
                    {leg.from_station} → {leg.to_station} • {leg.station_count} stations
                  </p>
                </div>
                <div className="trip-meta">
                  <span className="badge confirmed">{leg.duration}</span>
                </div>
              </div>
            ))}
            {journey.interchanges?.length > 0 && (
              <div className="trip-row">
                <div>
                  <strong>Interchanges</strong>
                  <p>{journey.interchanges.map((i) => i.station).join(', ')}</p>
                </div>
              </div>
            )}
          </div>

          {routeHighlight && mapGeometry && (
            <div style={{ marginTop: '14px' }}>
              <div
                className="row actions"
                style={{ marginBottom: '10px', justifyContent: 'flex-end', gap: '8px' }}
              >
                <button className="secondary" onClick={zoomOut} disabled={zoom <= ZOOM_MIN}>
                  −
                </button>
                <button className="secondary" onClick={zoomReset} style={{ minWidth: '64px' }}>
                  {Math.round(zoom * 100)}%
                </button>
                <button className="secondary" onClick={zoomIn} disabled={zoom >= ZOOM_MAX}>
                  +
                </button>
              </div>
              <div
                style={{
                  overflow: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: '12px',
                  maxHeight: '70vh',
                }}
              >
                <svg
                  width={mapGeometry.width * zoom}
                  height={mapGeometry.height * zoom}
                  viewBox={`0 0 ${mapGeometry.width} ${mapGeometry.height}`}
                  fontFamily={MAP_FONT}
                >
                  <rect
                    x={0}
                    y={0}
                    width={mapGeometry.width}
                    height={mapGeometry.height}
                    fill={PANEL_BG}
                  />

                  {/* Grey context layer: the full network, de-emphasized */}
                  {mapData.lines.map((line) => {
                    const codes = mapData.stationsByLine[line.line_code] || [];
                    const points = codes
                      .map((code) => mapGeometry.stationByCode[code])
                      .filter(Boolean)
                      .map((s) => {
                        const { x, y } = mapGeometry.project(s);
                        return `${x},${y}`;
                      })
                      .join(' ');
                    if (!points) return null;
                    return (
                      <polyline
                        key={line.line_code}
                        points={points}
                        fill="none"
                        stroke={GREY_LINE}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {Object.values(mapGeometry.stationByCode).map((s) => {
                    if (routeHighlight.routeCodes.has(s.station_code)) return null;
                    const { x, y } = mapGeometry.project(s);
                    return (
                      <circle
                        key={s.station_code}
                        cx={x}
                        cy={y}
                        r={s.interchange ? INTERCHANGE_RADIUS - 1 : STATION_RADIUS}
                        fill={s.interchange ? PANEL_BG : GREY_STATION}
                        stroke={s.interchange ? GREY_STATION : 'none'}
                        strokeWidth={s.interchange ? 2 : 0}
                      />
                    );
                  })}

                  {/* Highlight layer: the traversed path only */}
                  {routeHighlight.segments.map((seg, idx) => {
                    const points = seg.codes
                      .map((code) => mapGeometry.stationByCode[code])
                      .filter(Boolean)
                      .map((s) => {
                        const { x, y } = mapGeometry.project(s);
                        return `${x},${y}`;
                      })
                      .join(' ');
                    if (!points) return null;
                    return (
                      <polyline
                        key={idx}
                        points={points}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {[...routeHighlight.routeCodes].map((code) => {
                    const s = mapGeometry.stationByCode[code];
                    if (!s) return null;
                    const isEndpoint = code === routeHighlight.startCode || code === routeHighlight.endCode;
                    if (isEndpoint) return null;
                    const { x, y } = mapGeometry.project(s);
                    const seg = routeHighlight.segments.find((sg) => sg.codes.includes(code));
                    return (
                      <g key={code}>
                        <circle
                          cx={x}
                          cy={y}
                          r={s.interchange ? INTERCHANGE_RADIUS : ROUTE_STATION_RADIUS}
                          fill={s.interchange ? '#ffffff' : seg?.color || 'var(--text)'}
                          stroke={seg?.color || 'var(--text)'}
                          strokeWidth={s.interchange ? 3 : 1.5}
                        >
                          <title>{s.station_name}</title>
                        </circle>
                        {s.interchange && (
                          <text
                            x={x}
                            y={y - INTERCHANGE_RADIUS - 5}
                            fontSize="11"
                            fontWeight="600"
                            textAnchor="middle"
                            fill="var(--text)"
                            stroke={PANEL_BG}
                            strokeWidth={3}
                            paintOrder="stroke"
                          >
                            {s.station_name}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Endpoint markers, drawn last so they sit on top */}
                  {[
                    { code: routeHighlight.startCode, ring: '#1a9d5c', label: 'Start' },
                    { code: routeHighlight.endCode, ring: '#c0392b', label: 'End' },
                  ].map(({ code, ring, label }) => {
                    const s = mapGeometry.stationByCode[code];
                    if (!s) return null;
                    const { x, y } = mapGeometry.project(s);
                    return (
                      <g key={label}>
                        <circle cx={x} cy={y} r={ENDPOINT_RADIUS + 3} fill={ring} opacity={0.18} />
                        <circle cx={x} cy={y} r={ENDPOINT_RADIUS} fill="#ffffff" stroke={ring} strokeWidth={3.5}>
                          <title>{`${label}: ${s.station_name}`}</title>
                        </circle>
                        <text
                          x={x}
                          y={y - ENDPOINT_RADIUS - 6}
                          fontSize="12"
                          fontWeight="700"
                          textAnchor="middle"
                          fill={ring}
                          stroke={PANEL_BG}
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {label} • {s.station_name}
                        </text>
                      </g>
                    );
                  })}

                  {/* Legend */}
                  <g transform={`translate(${MAP_PADDING - 20}, ${MAP_PADDING - 20})`} fontSize="11">
                    <circle cx={4} cy={0} r={5} fill="#ffffff" stroke="#1a9d5c" strokeWidth={3} />
                    <text x={16} y={4} fill="var(--text)">Start</text>
                    <circle cx={64} cy={0} r={5} fill="#ffffff" stroke="#c0392b" strokeWidth={3} />
                    <text x={76} y={4} fill="var(--text)">End</text>
                    <line x1={122} y1={0} x2={142} y2={0} stroke="var(--primary-strong)" strokeWidth={4} strokeLinecap="round" />
                    <text x={148} y={4} fill="var(--text)">Your route</text>
                    <line x1={222} y1={0} x2={242} y2={0} stroke={GREY_LINE} strokeWidth={3} strokeLinecap="round" />
                    <text x={248} y={4} fill="var(--muted)">Network</text>
                  </g>
                </svg>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
