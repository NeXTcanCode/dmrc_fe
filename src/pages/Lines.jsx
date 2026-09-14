import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getLineStations, getLines } from '../services/metroService';

export default function Lines() {
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState(null);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getLines();
        setLines(data);
        if (data.length) setSelectedLine(data[0]);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || 'Failed to load lines');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedLine) return;
    const load = async () => {
      setStationsLoading(true);
      try {
        const data = await getLineStations(selectedLine.line_code);
        setStations(data);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || 'Failed to load stations');
      } finally {
        setStationsLoading(false);
      }
    };
    load();
  }, [selectedLine]);

  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="section-head">
        <h2>Lines</h2>
        <p>Live DMRC line status and station order, from the metro data source.</p>
      </div>

      {loading && <p>Loading...</p>}

      <div className="row" style={{ marginBottom: '14px' }}>
        {lines.map((line) => (
          <button
            key={line.id}
            type="button"
            className={selectedLine?.id === line.id ? 'active' : 'ghost'}
            style={{
              borderLeft: `4px solid ${line.primary_color_code}`,
              paddingLeft: '10px'
            }}
            onClick={() => setSelectedLine(line)}
          >
            {line.line_color}
          </button>
        ))}
      </div>

      {selectedLine && (
        <div className="feature-card" style={{ padding: '14px', marginBottom: '14px' }}>
          <strong>{selectedLine.line_color}</strong> ({selectedLine.line_code})
          <p style={{ marginTop: '4px' }}>
            {selectedLine.start_station} → {selectedLine.end_station}
          </p>
          <span className="badge confirmed" style={{ marginTop: '8px', display: 'inline-block' }}>
            {selectedLine.status}
          </span>
        </div>
      )}

      {stationsLoading && <p>Loading stations...</p>}

      <div className="list">
        {!stationsLoading &&
          stations.map((station, idx) => (
            <div key={station.id} className="trip-row">
              <div>
                <strong>
                  {idx + 1}. {station.station_name}
                </strong>
                <p>{station.station_code}</p>
              </div>
              <div className="trip-meta">
                {station.interchange && <span className="badge pending">Interchange</span>}
                <span className="badge confirmed">{station.status}</span>
              </div>
            </div>
          ))}
      </div>

      {error && <small className="error">{error}</small>}
    </motion.section>
  );
}
