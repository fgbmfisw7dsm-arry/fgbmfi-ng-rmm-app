import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "../services/supabaseService";
import { enqueueCheckIn } from "../services/offlineQueue";
import type { User } from "../types";

export function useCheckIn(eventId: string, user: User | null) {
  const queryClient = useQueryClient();
  const checkInMutation = useMutation({
    mutationFn: (params: { delegateId: string; sessionId?: string }) =>
      db.checkInDelegate(eventId, params.delegateId, user!, params.sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stats", eventId] });
      queryClient.invalidateQueries({ queryKey: ["delegates"] });
    },
    onError: (err: any, variables: { delegateId: string; sessionId?: string }) => {
      if (user && err?.message?.includes("Connection failed")) {
        enqueueCheckIn(eventId, variables.delegateId, user, variables.sessionId);
      }
    },
  });
  return { checkInMutation };
}