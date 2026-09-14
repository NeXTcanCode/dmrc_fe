import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import AuthForm from "./components/AuthForm";
import { logout } from "./features/authSlice";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Logs from "./pages/Logs";
import Plan from "./pages/Plan";
import Search from "./pages/Search";
import Lines from "./pages/Lines";
import MetroMap from "./pages/MetroMap";
import Alerts from "./pages/Alerts";

function Protected({ children }) {
  const token = useSelector((state) => state.auth.token);
  return token ? children : <Navigate to="/" replace />;
}

function Shell() {
  const dispatch = useDispatch();
  const location = useLocation();
  const { token, user } = useSelector((state) => state.auth);

  return (
    <div className="container">
      <header className="topbar card">
        <div>
          <p className="eyebrow">Delhi Metro Wallet</p>
          <h1>DMRC </h1>
        </div>
        <div style={{ display: "flex", gap: "20px" }}>
          {token && (
            <div className="userbox">
              <p>{user?.name}</p>
              <small>{user?.email}</small>
            </div>
          )}
          {token && (
            <button className="secondary" onClick={() => dispatch(logout())}>
              Logout
            </button>
          )}
        </div>
      </header>

      {token && (
        <section className="card navcard">
          <nav className="tabs row gx-2 gy-2">
            {[
              { to: "/dashboard", label: "Dashboard" },
              { to: "/history", label: "Trips" },
              { to: "/logs", label: "Logs" },
              { to: "/plan", label: "Plan" },
              { to: "/search", label: "Search" },
              { to: "/lines", label: "Lines" },
              { to: "/map", label: "Map" },
              { to: "/alerts", label: "Alerts" },
            ].map((item) => (
              <div
                key={item.to}
                className="col-6 col-sm-4 col-md-3 col-lg-auto"
              >
                <Link
                  className={location.pathname === item.to ? "active" : ""}
                  to={item.to}
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>
        </section>
      )}

      <Routes>
        <Route
          path="/"
          element={token ? <Navigate to="/dashboard" replace /> : <AuthForm />}
        />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/history"
          element={
            <Protected>
              <History />
            </Protected>
          }
        />
        <Route
          path="/logs"
          element={
            <Protected>
              <Logs />
            </Protected>
          }
        />
        <Route
          path="/plan"
          element={
            <Protected>
              <Plan />
            </Protected>
          }
        />
        <Route
          path="/search"
          element={
            <Protected>
              <Search />
            </Protected>
          }
        />
        <Route
          path="/lines"
          element={
            <Protected>
              <Lines />
            </Protected>
          }
        />
        <Route
          path="/map"
          element={
            <Protected>
              <MetroMap />
            </Protected>
          }
        />
        <Route
          path="/alerts"
          element={
            <Protected>
              <Alerts />
            </Protected>
          }
        />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
