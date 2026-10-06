"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

type SessionValue = {
  accessToken: string | null;
  ready: boolean;
  setAccessToken: (token: string | null) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside AppProviders");
  return value;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }));
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiRequest<{ accessToken: string }>("auth/refresh", undefined, { method: "POST" })
      .then((session) => setAccessToken(session.accessToken))
      .catch(() => setAccessToken(null))
      .finally(() => setReady(true));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={{ accessToken, ready, setAccessToken }}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}