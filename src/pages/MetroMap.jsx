import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getLineStations, getLines, getMapData } from '../services/metroService';

const MAP_PADDING = 40;
const INTERCHANGE_RADIUS = 7;
const STATION_RADIUS = 3;

export default function MetroMap() {
  const [view, setView] = useState('dmrc');

  const [lines, setLines] = useState([]);
  const [stationsByLine, setStationsByLine] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const lineData = await getLines();
        setLines(lineData);
        const entries = await Promise.all(
          lineData.map(async (line) => {
            try {
              const stations = await getLineStations(line.line_code);
              return [line.line_code, stations];
            } catch {
              return [line.line_code, []];
            }
          })
        );
        setStationsByLine(Object.fromEntries(entries));
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || 'Failed to load network map');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const [mapData, setMapData] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    const load = async () => {
      setMapLoading(true);
      setMapError('');
      try {
        const data = await getMapData();
        setMapData(data);
      } catch (e) {
        setMapError(e?.response?.data?.message || e?.message || 'Failed to load DMRC map');
      } finally {
        setMapLoading(false);
      }
    };
    load();
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

    return { stationByCode, width, height, project };
  }, [mapData]);

  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="section-head">
        <h2>Network Map</h2>
        <p>
          {view === 'dmrc'
            ? "DMRC's official network layout, station-accurate."
            : 'Every DMRC line, drawn as a station-order strip, sourced live.'}
        </p>
      </div>

      <div className="row actions" style={{ marginBottom: '16px' }}>
        <button
          className={view === 'dmrc' ? '' : 'secondary'}
          onClick={() => setView('dmrc')}
        >
          DMRC Map
        </button>
        <button
          className={view === 'app' ? '' : 'secondary'}
          onClick={() => setView('app')}
        >
          App View
        </button>
      </div>

      {view === 'dmrc' && (
        <>
          {mapLoading && <p>Loading DMRC map...</p>}
          {mapError && <small className="error">{mapError}</small>}
          {!mapLoading && !mapError && mapGeometry && (
            <div style={{ overflow: 'auto', border: '1px solid var(--line)', borderRadius: '12px' }}>
              <svg
                width={mapGeometry.width}
                height={mapGeometry.height}
                viewBox={`0 0 ${mapGeometry.width} ${mapGeometry.height}`}
              >
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
                      stroke={line.primary_color_code}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
                {Object.values(mapGeometry.stationByCode).map((s) => {
                  const { x, y } = mapGeometry.project(s);
                  return (
                    <g key={s.station_code}>
                      <circle
                        cx={x}
                        cy={y}
                        r={s.interchange ? INTERCHANGE_RADIUS : STATION_RADIUS}
                        fill={s.interchange ? '#ffffff' : 'var(--text)'}
                        stroke={s.interchange ? 'var(--text)' : 'none'}
                        strokeWidth={s.interchange ? 2 : 0}
                      >
                        <title>{s.station_name}</title>
                      </circle>
                      {s.interchange && (
                        <text
                          x={x}
                          y={y - INTERCHANGE_RADIUS - 4}
                          fontSize="10"
                          textAnchor="middle"
                          fill="var(--text)"
                        >
                          {s.station_name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </>
      )}

      {view === 'app' && (
        <>
          {loading && <p>Loading network...</p>}
          {error && <small className="error">{error}</small>}

          {!loading &&
            lines.map((line) => (
          <div key={line.id} style={{ marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}
            >
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: line.primary_color_code,
                  display: 'inline-block'
                }}
              />
              <strong>{line.line_color}</strong>
              <span className="badge confirmed">{line.status}</span>
            </div>
            <div
              style={{
                display: 'flex',
                overflowX: 'auto',
                gap: '0',
                paddingBottom: '8px',
                borderBottom: `3px solid ${line.primary_color_code}`
              }}
            >
              {(stationsByLine[line.line_code] || []).map((station, idx) => (
                <div
                  key={station.id}
                  style={{
                    flexShrink: 0,
                    padding: '4px 10px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    borderLeft: idx === 0 ? 'none' : '1px solid var(--muted)',
                    fontWeight: station.interchange ? 700 : 400
                  }}
                  title={station.station_code}
                >
                  {station.station_name}
                </div>
              ))}
            </div>
          </div>
            ))}
        </>
      )}
    </motion.section>
  );
}
