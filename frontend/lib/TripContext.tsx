"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { getTrip } from "./api";
import type { TripDetail } from "./types";

interface TripContextValue {
  trip: TripDetail | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ tripId, children }: { tripId: number; children: ReactNode }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    getTrip(tripId)
      .then((t) => {
        setTrip(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "載入行程失敗"))
      .finally(() => setLoading(false));
  }, [tripId]);

  useEffect(() => {
    // Fetch-on-mount/tripId-change with a loading flag — intentional, not a
    // cascading-render bug (reload is a stable useCallback keyed by tripId).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return <TripContext.Provider value={{ trip, loading, error, reload }}>{children}</TripContext.Provider>;
}

export function useTrip(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip must be used within TripProvider");
  return ctx;
}
