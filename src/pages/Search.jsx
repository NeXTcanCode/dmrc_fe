import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getLineStations,
  getLines,
  getStationDetail,
} from "../services/metroService";

const PAGE = 20;
const DEBOUNCE_MS = 2000;

// The upstream station search endpoint ignores its query and returns every
// station regardless of what's asked, so filtering is done client-side
// against the full catalog instead (fetched once, reused across searches).
let masterPromise = null;
const getMasterStations = () => {
  if (!masterPromise) {
    masterPromise = getLines().then(async (lines) => {
      const mapped = await Promise.all(
        lines.map((line) =>
          getLineStations(line.line_code).then((s) => s || [])
        )
      );
      const seen = new Set();
      const out = [];
      for (const list of mapped) {
        for (const s of list) {
          if (!seen.has(s.station_code)) {
            seen.add(s.station_code);
            out.push(s);
          }
        }
      }
      return out.sort((a, b) => a.station_name.localeCompare(b.station_name));
    });
  }
  return masterPromise;
};

function StationDetail({ detail }) {
  const gates = detail.gates || [];
  const lifts = detail.lifts || [];
  const parkings = detail.parkings || [];
  const escalatorCount = lifts.filter(
    (l) => l.lift_type === "Escalator"
  ).length;
  const liftCount = lifts.filter((l) => l.lift_type !== "Escalator").length;

  return (
    <div className="feature-card" style={{ padding: "16px" }}>
      <strong style={{ fontSize: "18px" }}>{detail.station_name}</strong>{" "}
      <span style={{ color: "var(--muted)" }}>({detail.station_code})</span>
      <p style={{ marginTop: "4px", color: "var(--muted)" }}>
        {detail.station_type} station
        {detail.station_commercial_name
          ? ` • ${detail.station_commercial_name}`
          : ""}
      </p>
      {detail.station_description && (
        <p style={{ marginTop: "8px", fontSize: "13px" }}>
          {detail.station_description}
        </p>
      )}
      <div className="row" style={{ marginTop: "12px" }}>
        {detail.interchange && (
          <span className="badge pending">Interchange</span>
        )}
        {detail.metro_lines?.map((line) => (
          <span
            key={line.id}
            className="badge confirmed"
            style={{ background: line.primary_color_code }}
          >
            {line.line_color}
          </span>
        ))}
      </div>
      {detail.station_facility?.length > 0 && (
        <div className="row" style={{ marginTop: "10px" }}>
          {detail.station_facility.map((f) => (
            <span key={f.name} className="badge autoConfirmed">
              {f.name}
            </span>
          ))}
        </div>
      )}
      <div className="info-chip-grid station-detail-section">
        <div className="info-chip">
          <strong>Phone</strong>
          <span>{detail.mobile || detail.landline || "—"}</span>
        </div>
        <div className="info-chip">
          <strong>Timing</strong>
          <span>
            {detail.opening_time?.slice(0, 5) || "—"} –{" "}
            {detail.closing_time?.slice(0, 5) || "—"}
          </span>
        </div>
        <div className="info-chip">
          <strong>Gates</strong>
          <span>{gates.length || "—"}</span>
        </div>
        <div className="info-chip">
          <strong>Lifts / Escalators</strong>
          <span>
            {liftCount} lift{liftCount === 1 ? "" : "s"} • {escalatorCount}{" "}
            escalator
            {escalatorCount === 1 ? "" : "s"}
          </span>
        </div>
        {parkings.length > 0 && (
          <div className="info-chip">
            <strong>Parking</strong>
            <span>
              {parkings[0].capacity_car} car • {parkings[0].capacity_motorcycle}{" "}
              bike
            </span>
          </div>
        )}
      </div>
      {gates.length > 0 && (
        <div className="station-detail-section">
          <h4>Gates</h4>
          <div className="info-chip-grid">
            {gates.map((g) => {
              const open = String(g.status).toLowerCase() === "open";
              return (
                <div
                  key={g.gate_code}
                  className={`gate-chip ${open ? "" : "closed"}`}
                >
                  <div>
                    <strong style={{ display: "block", fontSize: "12px" }}>
                      {g.gate_name}
                    </strong>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      {g.location}
                    </span>
                  </div>
                  <span
                    className={`dot ${open ? "open" : "closed"}`}
                    title={g.status}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {lifts.length > 0 && (
        <div className="station-detail-section">
          <h4>Lifts &amp; Escalators</h4>
          <div className="info-chip-grid">
            {lifts.map((l) => (
              <div key={l.code} className="info-chip">
                <strong>
                  {l.lift_type} {l.code}
                </strong>
                <span>{l.description_location}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {parkings.length > 0 && (
        <div className="station-detail-section">
          <h4>Parking</h4>
          <div className="info-chip-grid">
            {parkings.map((p) => (
              <div key={p.parking_code} className="info-chip">
                <strong>{p.provider}</strong>
                <span>
                  {p.location} — {p.capacity_car} car, {p.capacity_motorcycle}{" "}
                  bike, {p.capacity_cycle} cycle
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [allStations, setAllStations] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const [expandedCode, setExpandedCode] = useState(null);
  const [detailsByCode, setDetailsByCode] = useState({});
  const [detailLoadingCode, setDetailLoadingCode] = useState(null);
  const [error, setError] = useState("");

  // load the full station catalog once, shown by default before any typing
  useEffect(() => {
    getMasterStations()
      .then(setAllStations)
      .catch((e) =>
        setError(
          e?.response?.data?.message || e?.message || "Failed to load stations"
        )
      )
      .finally(() => setCatalogLoading(false));
  }, []);

  // debounce: only apply what the user typed to the filter 2s after they stop typing
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim().toLowerCase());
      setVisible(PAGE);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const results = debouncedQuery
    ? allStations.filter(
        (s) =>
          s.station_name.toLowerCase().includes(debouncedQuery) ||
          s.station_code.toLowerCase().includes(debouncedQuery)
      )
    : allStations;

  const isFiltering = query.trim().toLowerCase() !== debouncedQuery;

  const onToggle = async (code) => {
    if (expandedCode === code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(code);
    if (detailsByCode[code]) return; // already fetched, just expand

    setDetailLoadingCode(code);
    setError("");
    try {
      const data = await getStationDetail(code);
      setDetailsByCode((prev) => ({ ...prev, [code]: data }));
    } catch (e2) {
      setError(
        e2?.response?.data?.message || e2?.message || "Could not load station"
      );
    } finally {
      setDetailLoadingCode(null);
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
        <h2>Station Search</h2>
        <p>
          Browse every DMRC station, or type to filter. Click a station for
          facilities, gates, lifts and contact details.
        </p>
      </div>

      <div className="row" style={{ marginBottom: "14px" }}>
        <input
          type="text"
          placeholder="Filter by station name or code..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%" }}
        />
        <button
          type="button"
          style={{ margin: "auto" }}
          onClick={() => {
            setDebouncedQuery(query.trim().toLowerCase());
            setVisible(PAGE);
          }}
        >
          Search
        </button>
      </div>

      {catalogLoading && <p>Loading stations...</p>}
      {isFiltering && !catalogLoading && (
        <p style={{ color: "var(--muted)" }}>Filtering...</p>
      )}
      {error && <small className="error">{error}</small>}

      <div className="grid-1">
        <div className="list">
          {!catalogLoading && results.length === 0 && (
            <p>No stations match "{query}".</p>
          )}
          {!catalogLoading &&
            results.slice(0, visible).map((station) => {
              const isOpen = expandedCode === station.station_code;
              return (
                <div key={station.station_code}>
                  <button
                    type="button"
                    className="list-item-btn"
                    onClick={() => onToggle(station.station_code)}
                  >
                    <div
                      className="trip-row"
                      style={{
                        cursor: "pointer",
                        borderColor: isOpen
                          ? "var(--primary-strong)"
                          : undefined,
                        borderBottomLeftRadius: isOpen ? 0 : undefined,
                        borderBottomRightRadius: isOpen ? 0 : undefined,
                      }}
                    >
                      <div>
                        <strong>{station.station_name}</strong>
                        <p>{station.station_code}</p>
                      </div>
                      <div className="trip-meta">
                        <span
                          className="badge pending"
                          style={{ visibility: station.interchange ? "visible" : "hidden" }}
                        >
                          Interchange
                        </span>
                        <span aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="accordion"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div
                          style={{
                            border: "1px solid var(--primary-strong)",
                            borderTop: "none",
                            borderBottomLeftRadius: "12px",
                            borderBottomRightRadius: "12px",
                            padding: "0 2px 2px",
                          }}
                        >
                          {detailLoadingCode === station.station_code && (
                            <p style={{ padding: "12px" }}>
                              Loading station...
                            </p>
                          )}
                          {detailsByCode[station.station_code] && (
                            <StationDetail
                              detail={detailsByCode[station.station_code]}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          {!catalogLoading && visible < results.length && (
            <button
              type="button"
              className="primary"
              onClick={() => setVisible(visible + PAGE)}
            >
              Load More ({results.length - visible} more)
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}
