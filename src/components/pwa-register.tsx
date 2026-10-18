"use client";

import { useEffect } from "react";

/** Registers the service worker after mount; no-op where unsupported. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is progressive enhancement — registration failure
        // must never break the app.
      });
    }
  }, []);

  return null;
}
