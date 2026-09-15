import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "https://dmcc-be.onrender.com";

export const api = axios.create({ baseURL });

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

// The backend JWT expires after 1h with no refresh flow. Without this, an
// expired session just fails every authenticated request with a raw 401
// until the user manually logs out. Catch it here and bounce to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== "/") {
      setAuthToken("");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.setItem("sessionExpired", "1");
      window.location.assign("/");
    }
    return Promise.reject(error);
  }
);
