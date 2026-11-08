import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function httpUrl(value, name) {
  if (!value) return "";

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, a query, or a fragment.`);
  }

  return url.href.replace(/\/+$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_API_URL", "REACT_APP_API_URL", "FLASK_PROXY_TARGET"]);
  const apiUrl = httpUrl(env.VITE_API_URL ?? env.REACT_APP_API_URL, "VITE_API_URL");
  const target = httpUrl(env.FLASK_PROXY_TARGET || "http://127.0.0.1:5000", "FLASK_PROXY_TARGET");
  const proxy = {
    "^/api(?:/|$)": { target, changeOrigin: true },
    "^/(?:recommend|semantic-bio-recommend)(?:\\?|$)": { target, changeOrigin: true },
  };

  return {
    plugins: [react()],
    envPrefix: [],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
    },
    server: { host: "localhost", port: 3000, strictPort: true, proxy },
    preview: { host: "localhost", proxy },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/setupTests.js"],
    },
  };
});
