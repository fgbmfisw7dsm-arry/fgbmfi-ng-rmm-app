import { useQuery } from "@tanstack/react-query";
import { db } from "../services/supabaseService";
import type { User } from "../types";

export function useSearch(query: string, eventId: string, user: User | null, sessionId?: string) {
  const districtFilter = (user?.role === "REGISTRAR" && user?.district) ? user.district.trim() : undefined;
  return useQuery({
    queryKey: ["delegates", eventId, query, sessionId, districtFilter],
    queryFn: () => db.searchDelegates(query, eventId, districtFilter, sessionId),
    enabled: query.trim().length > 1 && !!eventId,
    staleTime: 15000,
    refetchOnWindowFocus: false,
  });
}