import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./app/App";
import "./styles/global.css";
import "./styles/theme-mint.css";
import "./styles/theme-turquoise.css";
import "./styles/theme-pink.css";
import "./styles/theme-neon.css";
import "./styles/theme-aurora.css";
import "./styles/page-turn.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
