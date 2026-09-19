import { useEffect, useState } from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import {
  autoClearLogs,
  getWalletLogs,
  manualClearLogs,
} from "../services/logsService";
import { AnimatePresence, motion } from "framer-motion";

const tabs = [
  { key: "all", label: "All" },
  { key: "recharge", label: "Transactions" },
  { key: "deduction", label: "Deductions" },
];

export default function Logs() {
  const [activeTab, setActiveTab] = useState("all");
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getWalletLogs(activeTab);
      setLogs(data);
    } catch (e) {
      setError(
        e?.response?.data?.message || e?.message || "Failed to load logs"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [activeTab]);

  const onManualClear = async () => {
    try {
      const data = await manualClearLogs();
      toast.success(`Manual clear done. Removed ${data.deletedCount} log(s).`);
      await loadLogs();
    } catch (e) {
      toast.error(
        e?.response?.data?.message || e?.message || "Manual clear failed"
      );
    }
  };

  const onAutoClear = async () => {
    try {
      const data = await autoClearLogs();
      toast.success(
        `Auto clear done. Removed ${data.deletedCount} log(s) older than 7 days.`
      );
      await loadLogs();
    } catch (e) {
      toast.error(
        e?.response?.data?.message || e?.message || "Auto clear failed"
      );
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
        <h2>Logs</h2>
        <p>Recharge and deduction activity with timestamps.</p>
      </div>

      <div className="tabs logs-subtabs" style={{ marginBottom: "14px" }}>
        {tabs.map((tab) => (
          <motion.button
            key={tab.key}
            className={activeTab === tab.key ? "active" : "ghost"}
            onClick={() => setActiveTab(tab.key)}
            type="button"
            whileTap={{ scale: 0.98 }}
          >
            {tab.label}
            {activeTab === tab.key && !loading && (
              <span className="log-count">{logs.length}</span>
            )}
          </motion.button>
        ))}
      </div>

      {!loading && logs.length > 0 && (
        <p className="log-total">
          Showing <strong>{logs.length}</strong>{" "}
          {activeTab === "recharge"
            ? "transactions"
            : activeTab === "deduction"
            ? "deductions"
            : "entries"}
          .
        </p>
      )}

      <div className="row actions" style={{ marginBottom: "12px" }}>
        <button className="danger" type="button" onClick={onManualClear}>
          Manual Clear
        </button>
        <button className="secondary" type="button" onClick={onAutoClear}>
          Auto Clear (7 Days)
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {!loading && logs.length === 0 && (
        <p>
          No{" "}
          {activeTab === "recharge"
            ? "transactions"
            : activeTab === "deduction"
            ? "deductions"
            : "logs"}{" "}
          found.
        </p>
      )}

      <motion.div className="list logs-list" layout>
        <AnimatePresence mode="popLayout">
          {!loading &&
            logs.map((item) => {
              const isRecharge = item.type === "recharge";
              return (
                <motion.article
                  key={item._id}
                  className={`trip-row log-row ${
                    isRecharge ? "log-credit" : "log-debit"
                  }`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="log-ic">
                    <span>{isRecharge ? "↗" : "↘"}</span>
                  </div>
                  <div className="log-body">
                    <strong
                      className={isRecharge ? "log-positive" : "log-negative"}
                    >
                      {isRecharge ? "+" : "-"} INR {item.amount}
                    </strong>
                    <p className="log-meta">
                      {item.note === "balance_correction"
                        ? "Balance correction"
                        : isRecharge
                        ? "Recharge"
                        : "Deduction"}{" "}
                      •{" "}
                      {dayjs(item.createdAt).format("DD MMM YYYY, hh:mm A")}
                    </p>
                  </div>
                  <div className="trip-meta">
                    <span
                      className={`badge ${
                        isRecharge ? "confirmed" : "log-deduction"
                      }`}
                    >
                      {isRecharge ? "Credit" : "Debit"}
                    </span>
                  </div>
                </motion.article>
              );
            })}
        </AnimatePresence>
      </motion.div>

      {error && <small className="error">{error}</small>}
    </motion.section>
  );
}
