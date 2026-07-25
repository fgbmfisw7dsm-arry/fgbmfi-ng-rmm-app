import { useQuery } from "@tanstack/react-query";
import { db } from "../services/supabaseService";
import type { User } from "../types";
import { isRegistrarRole } from "../types";

export function useSearch(query: string, eventId: string, user: User | null, sessionId?: string) {
  const districtFilter = (isRegistrarRole(user?.role || '') && user?.district) ? user.district.trim() : undefined;
  return useQuery({
    queryKey: ["delegates", eventId, query, sessionId, districtFilter],
    queryFn: () => db.searchDelegates(query, eventId, districtFilter, sessionId),
    enabled: query.trim().length > 1 && !!eventId,
    staleTime: 15000,
    refetchOnWindowFocus: false,
  });
}