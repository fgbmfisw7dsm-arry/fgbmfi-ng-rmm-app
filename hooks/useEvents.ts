import { useQuery } from "@tanstack/react-query";
import { db } from "../services/supabaseService";

export function useEvents() {
  return useQuery({ queryKey: ["events"], queryFn: () => db.getEvents(), staleTime: 300000 });
}
export function useSessions(eventId: string) {
  return useQuery({
    queryKey: ["sessions", eventId],
    queryFn: () => db.getSessions(eventId),
    enabled: !!eventId,
    staleTime: 300000,
  });
}
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => db.getSettings(),
    staleTime: 600000,
  });
}