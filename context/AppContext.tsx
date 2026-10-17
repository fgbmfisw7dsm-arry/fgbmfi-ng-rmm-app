import React from 'react';
import { User, Event } from '../types';

export const AppContext = React.createContext<{
  user: User | null;
  activeEventId: string;
  activeEvent: Event | null; // Full event object for status checking
  events: Event[]; // Shared global events list
  liveEventId: string | null; // v1.82: server-side live event pin (null = unpinned)
  login: (u: User) => void;
  logout: () => void;
  onEventChange: (id: string) => void;
  refreshActiveEvent: () => void;
  refreshEvents: () => Promise<void>; // Global trigger to refresh list
  refreshLiveEvent: () => Promise<void>; // v1.82
}>({ 
  user: null, 
  activeEventId: '', 
  activeEvent: null,
  events: [],
  liveEventId: null,
  login: () => {}, 
  logout: () => {}, 
  onEventChange: () => {},
  refreshActiveEvent: () => {},
  refreshEvents: async () => {},
  refreshLiveEvent: async () => {}
});