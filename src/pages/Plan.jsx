import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { stationOptions } from '../data/stations';
import { DMRC_STATION_CODES } from '../data/dmrcStationCodes';
import { planJourney } from '../services/metroService';

const plannableStations = stationOptions
  .filter((s) => DMRC_STATION_CODES[s.name])
  .sort((a, b) => a.name.localeCompare(b.name));

export default function Plan() {
  const [fromName, setFromName] = useState(plannableStations[0]?.name || '');
  const [toName, setToName] = useState(plannableStations[1]?.name || '');
  const [strategy, setStrategy] = useState('least-distance');
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fromCode = useMemo(() => DMRC_STATION_CODES[fromName], [fromName]);
  const toCode = useMemo(() => DMRC_STATION_CODES[toName], [toName]);

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
        </div>
      )}
    </motion.section>
  );
}
