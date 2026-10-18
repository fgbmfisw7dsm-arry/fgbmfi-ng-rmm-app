import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../services/supabaseService";
import { SessionResponseType } from "../types";

// v1.83: Session Details writes are no longer TanStack mutations. React Query's
// default `networkMode: 'online'` PAUSES a mutation when navigator.onLine is
// false, so the mutationFn never runs — the offline queue fast-path inside
// db.recordSessionResponse never executes and the caller's await never settles
// (perpetual "Recording…" / "WAIT…"). Door write paths call db.* directly.
export function useMinistry(eventId: string) {
  const queryClient = useQueryClient();

  const dashboard = useQuery({
    queryKey: ["ministry-dashboard", eventId],
    queryFn: () => db.getSessionMinistryDashboard(eventId),
    enabled: !!eventId,
    staleTime: 10000,
    refetchInterval: 15000,
  });

  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ["ministry-dashboard", eventId] });
    queryClient.invalidateQueries({ queryKey: ["ministry-export", eventId] });
  };

  return { dashboard, invalidateDashboard };
}

export function useMinistryExport(eventId: string) {
  return useQuery({
    queryKey: ["ministry-export", eventId],
    queryFn: () => db.getMinistryDataForExport(eventId),
    enabled: !!eventId,
    staleTime: 30000,
  });
}

export function useSessionResponses(sessionId: string, responseType?: SessionResponseType) {
  return useQuery({
    queryKey: ["session-responses", sessionId, responseType],
    queryFn: () => db.getSessionResponses(sessionId, responseType),
    enabled: !!sessionId,
    staleTime: 10000,
  });
}
