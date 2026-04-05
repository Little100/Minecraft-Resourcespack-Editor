import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "@mpe/ui/tokens/variables.css";
import "@mpe/ui/tokens/z-index.css";
import "@mpe/ui/tokens/acrylic.css";
import "@mpe/ui/tokens/animations.css";

import { registerMpeUI } from "@mpe/ui/plugin-api";

import { ToastProvider } from "@mpe/ui";

registerMpeUI();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
