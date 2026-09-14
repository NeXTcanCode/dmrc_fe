import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { motion } from 'framer-motion';
import { getNotifications } from '../services/metroService';

export default function Alerts() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getNotifications();
        setNotifications(data);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || 'Failed to load alerts');
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
        <h2>Alerts</h2>
        <p>Official DMRC notices and service updates.</p>
      </div>

      {loading && <p>Loading alerts...</p>}
      {error && <small className="error">{error}</small>}

      <div className="list">
        {!loading && notifications.length === 0 && <p>No alerts right now.</p>}
        {!loading &&
          notifications.map((item) => (
            <a
              key={item.id}
              href={item.link_to_outside_url || undefined}
              target={item.link_to_outside_url ? '_blank' : undefined}
              rel="noreferrer"
              className="trip-row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div>
                <strong>{item.title}</strong>
                <p>{dayjs(item.date).format('DD-MM-YYYY')}</p>
              </div>
              <div className="trip-meta">
                <span className="badge pending">{item.notification_type?.name || 'Notice'}</span>
              </div>
            </a>
          ))}
      </div>
    </motion.section>
  );
}
