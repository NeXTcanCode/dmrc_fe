import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { login, register } from "../features/authSlice";
import { motion } from "framer-motion";

export default function AuthForm() {
  const dispatch = useDispatch();
  const { loading } = useSelector((state) => state.auth);
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sessionExpired] = useState(() => {
    const expired = localStorage.getItem("sessionExpired") === "1";
    if (expired) localStorage.removeItem("sessionExpired");
    return expired;
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "register") {
        await dispatch(register({ name, email, password })).unwrap();
      } else {
        await dispatch(login({ email, password })).unwrap();
      }
    } catch (err) {
      setError(
        err?.response?.data?.message || err?.message || "Authentication failed"
      );
    }
  };

  return (
    <motion.section
      className="card auth-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="auth-head">
        {/* <img
          src="/images/Delhi_Metro_logo.webp"
          alt="DMRC logo"
          className="auth-logo"
        /> */}
        <p className="eyebrow">Secure Access</p>
        <h2>{mode === "login" ? "Welcome Back" : "Create Your Account"}</h2>
      </div>
      {sessionExpired && (
        <small className="error">
          Your session expired. Please log in again.
        </small>
      )}

      <form className="form-grid" onSubmit={onSubmit}>
        {mode === "register" && (
          <label>
            <span>Name</span>
            <input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}

        <label>
          <span>Email</span>
          <input
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <div className="row actions">
          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Login"
              : "Create account"}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
      </form>
      {error && <small className="error">{error}</small>}
    </motion.section>
  );
}
