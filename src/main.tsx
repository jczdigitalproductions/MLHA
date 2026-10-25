import React from "react";
import { createRoot } from "react-dom/client";
import CivicTwinDashboard from "./components/CivicTwinDashboard";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <CivicTwinDashboard />
  </React.StrictMode>
);
