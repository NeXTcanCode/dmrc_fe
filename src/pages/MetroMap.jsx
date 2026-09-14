import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getLineStations, getLines } from '../services/metroService';

export default function MetroMap() {
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

  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="section-head">
        <h2>Network Map</h2>
        <p>Every DMRC line, drawn as a station-order strip, sourced live.</p>
      </div>

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
    </motion.section>
  );
}
