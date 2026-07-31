import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../services/supabaseService";
import { SessionResponseType } from "../types";
import type { User } from "../types";

export function useMinistry(eventId: string, user: User | null) {
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

  const recordResponse = useMutation({
    mutationFn: (params: { delegateId: string; sessionId: string; responseType: SessionResponseType }) =>
      db.recordSessionResponse(eventId, params.delegateId, params.sessionId, params.responseType, user!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ministry-dashboard", eventId] });
    },
  });

  const recordSummary = useMutation({
    mutationFn: (params: { sessionId: string; responseType: SessionResponseType; totalCount: number }) =>
      db.recordSessionResponseSummary(eventId, params.sessionId, params.responseType, params.totalCount, user!),
    onSuccess: () => invalidateDashboard(),
  });

  const recordVD = useMutation({
    mutationFn: (params: { sessionId: string; total: number }) =>
      db.recordVoiceDistribution(eventId, params.sessionId, params.total, user!),
    onSuccess: () => invalidateDashboard(),
  });

  return { dashboard, recordResponse, recordSummary, recordVD, invalidateDashboard };
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
