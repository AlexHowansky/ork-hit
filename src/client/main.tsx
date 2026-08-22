import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { initTheme } from "./theme.ts";
import "./styles.css";

// Applied before the first render so a stored theme choice doesn't flash the
// other one. The system preference needs no script at all — it is pure CSS.
initTheme();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
