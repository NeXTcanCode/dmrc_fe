import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import toast from "react-hot-toast";
import {
  AnimatePresence,
  motion,
  useScroll,
  useTransform,
} from "framer-motion";
import { geoStations, stationOptions } from "../data/stations";
import {
  addRecharge,
  deductAmount,
  fetchWallet,
} from "../features/walletSlice";
import {
  addPendingTrip,
  fetchTrips,
  markTripConfirmed,
} from "../features/tripsSlice";
import {
  distanceInMeters,
  findNearestStation,
} from "../services/geolocationService";

const STATION_RADIUS_M = 120;
const MIN_TRAVEL_MINUTES = 5;
const MAX_ACCEPTABLE_ACCURACY_M = 100;
const WEEKDAY_SLABS = [
  { maxKm: 2, fare: 11 },
  { maxKm: 5, fare: 21 },
  { maxKm: 12, fare: 32 },
  { maxKm: 21, fare: 43 },
  { maxKm: 32, fare: 54 },
  { maxKm: Infinity, fare: 64 },
];
const HOLIDAY_SLABS = [
  { maxKm: 2, fare: 11 },
  { maxKm: 5, fare: 11 },
  { maxKm: 12, fare: 21 },
  { maxKm: 21, fare: 32 },
  { maxKm: 32, fare: 43 },
  { maxKm: Infinity, fare: 54 },
];
const NATIONAL_HOLIDAYS = ["01-26", "08-15", "10-02"];
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

const useCountUp = (value, duration = 550) => {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const to = Number(value || 0);
    let startTs = 0;
    const from = display;
    const step = (ts) => {
      if (!startTs) startTs = ts;
      const p = Math.min((ts - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return display;
};

export default function Dashboard() {
  const dispatch = useDispatch();
  const wallet = useSelector((state) => state.wallet);
  const trips = useSelector((state) => state.trips.items);

  const [rechargeAmount, setRechargeAmount] = useState("100");
  const [rechargeMode, setRechargeMode] = useState("online");
  const [boardingStationId, setBoardingStationId] = useState(
    stationOptions[0]?.id || ""
  );
  const [alightingStationId, setAlightingStationId] = useState(
    stationOptions[1]?.id || stationOptions[0]?.id || ""
  );
  const [boardingSearch, setBoardingSearch] = useState("");
  const [alightingSearch, setAlightingSearch] = useState("");
  const [debouncedBoardingSearch, setDebouncedBoardingSearch] = useState("");
  const [debouncedAlightingSearch, setDebouncedAlightingSearch] = useState("");
  const [error, setError] = useState("");

  const [monitoring, setMonitoring] = useState(false);
  const [monitorMessage, setMonitorMessage] = useState(
    "Travel monitoring is off"
  );

  const watchIdRef = useRef(null);
  const { scrollY } = useScroll();
  const orbY1 = useTransform(scrollY, [0, 900], [0, -40]);
  const orbY2 = useTransform(scrollY, [0, 900], [0, -65]);
  const travelStateRef = useRef({
    boardedStation: null,
    boardedAt: null,
    lastCreatedAt: 0,
  });

  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([
          dispatch(fetchWallet()).unwrap(),
          dispatch(fetchTrips()).unwrap(),
        ]);
      } catch (e) {
        setError(
          e?.response?.data?.message || e?.message || "Failed to load dashboard"
        );
      }
    };
    load();
  }, [dispatch]);

  useEffect(
    () => () => {
      if (watchIdRef.current !== null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    },
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedBoardingSearch(boardingSearch.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(timer);
  }, [boardingSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAlightingSearch(alightingSearch.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(timer);
  }, [alightingSearch]);

  const pendingTrips = useMemo(
    () => trips.filter((t) => t.status === "pending"),
    [trips]
  );
  const animatedCurrent = useCountUp(wallet.currentBalance || 0);
  const animatedPending = useCountUp(wallet.pendingDeduction || 0);
  const animatedAvailable = useCountUp(wallet.availableBalance || 0);
  const stationNameById = useMemo(
    () => Object.fromEntries(stationOptions.map((s) => [s.id, s.name])),
    []
  );
  const geoStationById = useMemo(
    () => Object.fromEntries(geoStations.map((s) => [s.id, s])),
    []
  );
  const filteredBoardingOptions = useMemo(() => {
    if (!debouncedBoardingSearch) return stationOptions;
    return stationOptions.filter((s) =>
      s.name.toLowerCase().includes(debouncedBoardingSearch)
    );
  }, [debouncedBoardingSearch]);
  const filteredAlightingOptions = useMemo(() => {
    if (!debouncedAlightingSearch) return stationOptions;
    return stationOptions.filter((s) =>
      s.name.toLowerCase().includes(debouncedAlightingSearch)
    );
  }, [debouncedAlightingSearch]);
  const remainingCapacity = Math.max(0, 3000 - (wallet.currentBalance || 0));

  const getEstimatedDistanceKm = (fromId, toId) => {
    if (!fromId || !toId) return 5;
    if (fromId === toId) return 0;

    const parse = (id) => {
      const m = id.match(/^([A-Z]+)(\d+)$/);
      return m ? { prefix: m[1], num: Number(m[2]) } : null;
    };

    const fromMeta = parse(fromId);
    const toMeta = parse(toId);

    if (fromMeta && toMeta && fromMeta.prefix === toMeta.prefix) {
      const hops = Math.max(1, Math.abs(fromMeta.num - toMeta.num));
      return Number((hops * 1.2).toFixed(1));
    }

    const fromGeo = geoStationById[fromId];
    const toGeo = geoStationById[toId];
    if (fromGeo && toGeo) {
      return Math.max(
        1,
        Number((distanceInMeters(fromGeo, toGeo) / 1000).toFixed(1))
      );
    }

    return 8;
  };

  const estimatedDistanceKm = useMemo(
    () => getEstimatedDistanceKm(boardingStationId, alightingStationId),
    [boardingStationId, alightingStationId]
  );

  const estimatedFare = useMemo(() => {
    const date = new Date();
    const day = date.getDay(); // 0 Sunday
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(date.getDate()).padStart(2, "0");
    const isHoliday = NATIONAL_HOLIDAYS.includes(`${month}-${dayOfMonth}`);
    const useHolidayRate = day === 0 || isHoliday;
    const slabs = useHolidayRate ? HOLIDAY_SLABS : WEEKDAY_SLABS;

    let baseFare = 11;
    for (const slab of slabs) {
      if (estimatedDistanceKm <= slab.maxKm) {
        baseFare = slab.fare;
        break;
      }
    }

    // Smart-card weekday off-peak discount
    let finalFare = baseFare;
    if (!useHolidayRate) {
      const hour = date.getHours();
      const offPeak = hour < 8 || (hour >= 12 && hour < 17) || hour >= 21;
      if (offPeak) finalFare = Math.round(baseFare * 0.9);
    }
    return Math.max(11, finalFare);
  }, [estimatedDistanceKm]);

  useEffect(() => {
    if (!filteredBoardingOptions.length) return;
    const exists = filteredBoardingOptions.some(
      (s) => s.id === boardingStationId
    );
    if (!exists) setBoardingStationId(filteredBoardingOptions[0].id);
  }, [filteredBoardingOptions, boardingStationId]);

  useEffect(() => {
    if (!filteredAlightingOptions.length) return;
    const exists = filteredAlightingOptions.some(
      (s) => s.id === alightingStationId
    );
    if (!exists) setAlightingStationId(filteredAlightingOptions[0].id);
  }, [filteredAlightingOptions, alightingStationId]);

  useEffect(() => {
    const amount = Number(rechargeAmount || 0);
    if (rechargeMode === "customer_care") {
      if (amount < 200 || amount % 100 !== 0) setRechargeAmount("200");
      return;
    }
    if (amount < 100 || amount % 50 !== 0) setRechargeAmount("100");
  }, [rechargeMode]);

  const getRechargeValidationMessage = (rawAmount, mode, remaining) => {
    if (!rawAmount || Number.isNaN(Number(rawAmount)))
      return "Enter a valid recharge amount.";
    const amount = Number(rawAmount);

    if (amount <= 0) return "Recharge amount must be greater than 0.";
    if (amount > remaining)
      return `Recharge exceeds card limit. You can add up to INR ${remaining}.`;

    if (mode === "customer_care") {
      if (amount < 200)
        return "Customer Care recharge must be at least INR 200.";
      if (amount % 100 !== 0)
        return "Customer Care recharge must be in multiples of INR 100.";
      return "";
    }

    if (amount < 100) return "Online/TVM recharge must be at least INR 100.";
    if (amount % 50 !== 0)
      return "Online/TVM recharge must be in multiples of INR 50.";
    return "";
  };

  const refresh = async () => {
    await Promise.all([
      dispatch(fetchWallet()).unwrap(),
      dispatch(fetchTrips()).unwrap(),
    ]);
  };

  const onRecharge = async () => {
    setError("");
    const validationMessage = getRechargeValidationMessage(
      rechargeAmount,
      rechargeMode,
      remainingCapacity
    );
    if (validationMessage) {
      setError(validationMessage);
      toast.error(validationMessage);
      return;
    }

    try {
      await dispatch(
        addRecharge({ amount: Number(rechargeAmount), mode: rechargeMode })
      ).unwrap();
      await dispatch(fetchWallet()).unwrap();
      toast.success("Wallet recharged successfully");
      setRechargeAmount("100");
    } catch (e) {
      const backendMessage = e?.response?.data?.message || "";
      const msg = backendMessage.includes("multiples")
        ? `${backendMessage}. Please adjust the amount and try again.`
        : backendMessage ||
          e?.message ||
          "Recharge failed. Please check the amount and mode.";
      setError(msg);
      toast.error(msg);
    }
  };

  const onDebit = async () => {
    setError("");
    if (!rechargeAmount || Number.isNaN(Number(rechargeAmount))) {
      const msg = "Enter a valid amount to rectify.";
      setError(msg);
      toast.error(msg);
      return;
    }

    const amount = Number(rechargeAmount);
    if (amount <= 0) {
      const msg = "Rectify amount must be greater than 0.";
      setError(msg);
      toast.error(msg);
      return;
    }

    if (amount > (wallet.currentBalance || 0)) {
      const msg = `You can rectify up to INR ${wallet.currentBalance || 0}.`;
      // setError(msg);
      toast.error(msg);
      return;
    }

    try {
      await dispatch(deductAmount({ amount })).unwrap();
      await dispatch(fetchWallet()).unwrap();
      toast.success("Amount debited successfully");
      setRechargeAmount("100");
    } catch (e) {
      const msg =
        e?.response?.data?.message || e?.message || "Failed to debit amount";
      setError(msg);
      toast.error(msg);
    }
  };

  const onAddPendingTrip = async () => {
    setError("");
    if (!boardingStationId || !alightingStationId) {
      const msg = "Select both boarding and alighting stations.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (boardingStationId === alightingStationId) {
      const msg = "Boarding and alighting stations cannot be the same.";
      setError(msg);
      toast.error(msg);
      return;
    }

    try {
      await dispatch(
        addPendingTrip({
          boardingStationId,
          alightingStationId,
          boardingStationName: stationNameById[boardingStationId],
          alightingStationName: stationNameById[alightingStationId],
          distanceKm: estimatedDistanceKm,
          isSmartCard: true,
        })
      ).unwrap();
      toast.success("Pending trip created");
      await refresh();
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          "Failed to create pending trip"
      );
    }
  };

  const onConfirm = async (id) => {
    setError("");
    try {
      await dispatch(markTripConfirmed(id)).unwrap();
      await refresh();
    } catch (e) {
      setError(
        e?.response?.data?.message || e?.message || "Failed to confirm trip"
      );
    }
  };

  const handlePosition = async (position) => {
    // A GPS fix with poor accuracy (common underground/near tall buildings)
    // can report a wildly wrong position, which would corrupt the 120m
    // station-radius check below - so unreliable fixes are ignored outright
    // rather than acted on. `accuracy` is the radius (meters) of the
    // confidence circle the browser itself reports for this fix.
    const accuracy = position.coords.accuracy;
    if (typeof accuracy === "number" && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
      setMonitorMessage(
        `Waiting for a better GPS fix (accuracy ±${Math.round(accuracy)}m)...`
      );
      return;
    }

    const coords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    const nearest = findNearestStation(coords, geoStations);
    if (!nearest) return;

    if (nearest.meters > STATION_RADIUS_M) {
      setMonitorMessage(
        `Moving. Nearest station: ${nearest.station.name} (${Math.round(
          nearest.meters
        )}m)`
      );
      return;
    }

    const now = Date.now();
    const state = travelStateRef.current;

    if (!state.boardedStation) {
      state.boardedStation = nearest.station;
      state.boardedAt = now;
      setMonitorMessage(
        `Boarding detected at ${nearest.station.name}. Waiting for destination...`
      );
      return;
    }

    if (state.boardedStation.id === nearest.station.id) {
      setMonitorMessage(
        `Still at ${nearest.station.name}. Monitoring continues.`
      );
      return;
    }

    const tripMinutes = (now - state.boardedAt) / 60000;
    if (tripMinutes < MIN_TRAVEL_MINUTES) {
      setMonitorMessage(
        `Detected ${nearest.station.name}. Waiting minimum ${MIN_TRAVEL_MINUTES} min trip window.`
      );
      return;
    }

    if (now - state.lastCreatedAt < 120000) return;

    // Reserve the cooldown before the request goes out, not after it
    // resolves. watchPosition can fire another update while this request is
    // still in flight; without reserving first, that second call would also
    // pass the cooldown check above and create a duplicate pending trip.
    state.lastCreatedAt = now;

    const meters = distanceInMeters(state.boardedStation, nearest.station);
    const distanceKmAuto = Math.max(1, Number((meters / 1000).toFixed(1)));
    const fromStationName = state.boardedStation.name;
    const toStationName = nearest.station.name;

    try {
      await dispatch(
        addPendingTrip({
          boardingStationId: state.boardedStation.id,
          alightingStationId: nearest.station.id,
          boardingStationName: fromStationName,
          alightingStationName: toStationName,
          distanceKm: distanceKmAuto,
          isSmartCard: true,
          travelDate: new Date().toISOString(),
        })
      ).unwrap();

      state.boardedStation = nearest.station;
      state.boardedAt = now;

      setMonitorMessage(
        `Trip captured: ${distanceKmAuto} km from ${fromStationName} to ${toStationName}.`
      );
      await refresh();
    } catch (e) {
      state.lastCreatedAt = 0; // release the reservation so the next detection can retry
      setError(
        e?.response?.data?.message || e?.message || "Auto trip creation failed"
      );
    }
  };

  const startMonitoring = () => {
    setError("");
    if (!navigator.geolocation)
      return setError("Geolocation not supported in this browser");
    if (watchIdRef.current !== null) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) =>
        handlePosition(position).catch(() =>
          setError("Location processing failed")
        ),
      (geoError) => setError(geoError.message || "Unable to read location"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    setMonitoring(true);
    setMonitorMessage(
      "Travel monitoring enabled. Move near stations to auto-capture trips."
    );
  };

  const stopMonitoring = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    travelStateRef.current = {
      boardedStation: null,
      boardedAt: null,
      lastCreatedAt: 0,
    };
    setMonitoring(false);
    setMonitorMessage("Travel monitoring is off");
  };

  return (
    <motion.div
      className="grid-2"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.section
        className="card feature-card full"
        variants={itemVariants}
      >
        <motion.div className="parallax-orb orb-a" style={{ y: orbY1 }} />
        <motion.div className="parallax-orb orb-b" style={{ y: orbY2 }} />
        <div className="monitor-head">
          <div className="section-head">
            <h2>Travel Monitoring</h2>
            <p>Automatic trip capture using live geolocation.</p>
          </div>
        </div>
        <div className="monitor-row">
          <p className="monitor-line">{monitorMessage}</p>
          <div className="row actions monitor-actions">
            {!monitoring && (
              <button onClick={startMonitoring}>Enable Monitoring</button>
            )}
            {monitoring && (
              <button className="secondary" onClick={stopMonitoring}>
                Stop Monitoring
              </button>
            )}
          </div>
        </div>
      </motion.section>

      <motion.div className="metrics-grid full" variants={itemVariants}>
        <motion.section className="card metric-card" whileHover={{ y: -2 }}>
          <h3>Current Balance</h3>
          <strong>INR {animatedCurrent}</strong>
        </motion.section>
        <motion.section className="card metric-card" whileHover={{ y: -2 }}>
          <h3>Pending Deduction</h3>
          <strong>INR {animatedPending}</strong>
        </motion.section>
        <motion.section className="card metric-card" whileHover={{ y: -2 }}>
          <h3>Available Balance</h3>
          <strong>INR {animatedAvailable}</strong>
        </motion.section>
      </motion.div>

      <motion.section className="card full" variants={itemVariants}>
        <div className="section-head">
          <h2>Recharge Wallet</h2>
          <p>
            Card max: INR 3000. Remaining capacity: INR {remainingCapacity}. Use
            Rectify (-) if a wrong recharge was made.
          </p>
        </div>
        <div className="row actions manual-grid">
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <input
              value={rechargeAmount}
              onChange={(e) => setRechargeAmount(e.target.value)}
              type="number"
              min={rechargeMode === "customer_care" ? "200" : "100"}
              step={rechargeMode === "customer_care" ? "100" : "50"}
            />
          </motion.div>
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <select
              value={rechargeMode}
              onChange={(e) => setRechargeMode(e.target.value)}
            >
              <option value="online">Online/TVM (min 100, step 50)</option>
              <option value="customer_care">
                Customer Care (min 200, step 100)
              </option>
            </select>
          </motion.div>
          <motion.button onClick={onRecharge} whileTap={{ scale: 0.98 }}>
            Recharge
          </motion.button>
          <motion.button
            className="danger"
            onClick={onDebit}
            whileTap={{ scale: 0.98 }}
          >
            Rectify (-)
          </motion.button>
        </div>
      </motion.section>

      <motion.section className="card full" variants={itemVariants}>
        <div className="section-head">
          <h2>
            Manual Trip Fallback
            <span style={{ fontSize: "14px" }}>
              (Only if geolocation is unavailable.)
            </span>
          </h2>
        </div>

        <div className="row actions manual-grid">
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <input
              type="text"
              placeholder="Search boarding station..."
              value={boardingSearch}
              onChange={(e) => setBoardingSearch(e.target.value)}
            />
          </motion.div>
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <select
              value={boardingStationId}
              onChange={(e) => setBoardingStationId(e.target.value)}
            >
              {filteredBoardingOptions.length ? (
                filteredBoardingOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              ) : (
                <option value="">No stations found</option>
              )}
            </select>
          </motion.div>
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <input
              type="text"
              placeholder="Search alighting station..."
              value={alightingSearch}
              onChange={(e) => setAlightingSearch(e.target.value)}
            />
          </motion.div>
          <motion.div
            className="field-motion"
            whileHover={{ y: -1 }}
            whileFocus={{ scale: 1.01 }}
          >
            <select
              value={alightingStationId}
              onChange={(e) => setAlightingStationId(e.target.value)}
            >
              {filteredAlightingOptions.length ? (
                filteredAlightingOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              ) : (
                <option value="">No stations found</option>
              )}
            </select>
          </motion.div>
          <motion.button
            className="manual-submit"
            onClick={onAddPendingTrip}
            whileTap={{ scale: 0.98 }}
          >
            Create Pending Trip
          </motion.button>
        </div>
        <p className="manual-estimate" style={{ marginTop: "8px" }}>
          Estimated distance for fare: <strong>{estimatedDistanceKm} km</strong>{" "}
          • Estimated fare: <strong>INR {estimatedFare}</strong>
        </p>
      </motion.section>

      <motion.section className="card full" variants={itemVariants}>
        <div className="section-head">
          <h2>Pending Trips</h2>
        </div>

        {pendingTrips.length === 0 && <p>No pending trips.</p>}
        <motion.div className="list" layout>
          <AnimatePresence mode="popLayout">
            {pendingTrips.map((trip) => (
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
                  <strong>
                    {stationNameById[trip.boardingStationId] ||
                      "Unknown Station"}
                  </strong>
                  <p>
                    to{" "}
                    {stationNameById[trip.alightingStationId] ||
                      "Unknown Station"}{" "}
                    • {trip.distanceKm} km
                  </p>
                </div>
                <div className="trip-meta">
                  <span>INR {trip.fare}</span>
                  <button onClick={() => onConfirm(trip._id)}>Confirm</button>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      </motion.section>

      <AnimatePresence>
        {error && (
          <motion.small
            className="error full"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            {error}
          </motion.small>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
