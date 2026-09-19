import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useDispatch, useSelector } from 'react-redux';
import { fetchTrips, removeTrip } from '../features/tripsSlice';
import { clearTripHistory } from '../services/tripsService';
import { stationOptions } from '../data/stations';
import { AnimatePresence, motion } from 'framer-motion';

export default function History() {
  const dispatch = useDispatch();
  const trips = useSelector((state) => state.trips.items);
  const [error, setError] = useState('');
  const stationNameById = Object.fromEntries(stationOptions.map((s) => [s.id, s.name]));

  useEffect(() => {
    dispatch(fetchTrips()).unwrap().catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load history'));
  }, [dispatch]);

  const onDelete = async (id) => {
    setError('');
    try {
      await dispatch(removeTrip(id)).unwrap();
      await dispatch(fetchTrips()).unwrap();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Failed to delete trip');
    }
  };

  const onClearAll = async () => {
    if (!window.confirm('Clear all trip history? Pending trips are kept.')) return;
    setError('');
    try {
      await clearTripHistory();
      await dispatch(fetchTrips()).unwrap();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Failed to clear history');
    }
  };

  const hasClearable = trips.some((t) => t.status !== 'pending');

  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="section-head">
        <h2>Trip History</h2>
        <p>Review pending, confirmed and auto-confirmed trips.</p>
        {hasClearable && (
          <button className="danger" onClick={onClearAll}>Clear All History</button>
        )}
      </div>

      {trips.length === 0 && <p>No trips found.</p>}

      <motion.div className="list" layout>
        <AnimatePresence mode="popLayout">
        {trips.map((trip) => (
          <motion.article
            key={trip._id}
            className="trip-row"
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div>
              <strong>{stationNameById[trip.boardingStationId] || 'Unknown Station'}</strong>
              <p>
                to {stationNameById[trip.alightingStationId] || 'Unknown Station'} • {dayjs(trip.date).format('DD MMM YYYY, hh:mm A')}
              </p>
            </div>

            <div className="trip-meta">
              <span>INR {trip.fare}</span>
              <span className={`badge ${trip.status}`}>{trip.status}</span>
              <button className="danger" onClick={() => onDelete(trip._id)}>Delete</button>
            </div>
          </motion.article>
        ))}
        </AnimatePresence>
      </motion.div>

      {error && <small className="error">{error}</small>}
    </motion.section>
  );
}
