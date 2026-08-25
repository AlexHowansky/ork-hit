import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config } from "@fortawesome/fontawesome-svg-core";
import { App } from "./app.tsx";
import { initTheme } from "./theme.ts";
import { loadAppearance } from "./appearance.ts";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./styles.css";

// FontAwesome would otherwise write a <style> element into the head the first
// time an icon renders. Every other stylesheet here is bundled, and this keeps
// it that way — the page's own policy allows an inline style, but a library
// quietly editing the head is a surprise the next reader of the CSP does not
// need. Set before anything can draw an icon, as their docs require.
config.autoAddCss = false;

// Applied before the first render so a stored theme choice doesn't flash the
// other one. The system preference needs no script at all — it is pure CSS.
initTheme();

// Asked for before React is even mounted, so it is in place by the time there is
// a card to draw. `styles.css` holds the default until it lands.
loadAppearance();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
