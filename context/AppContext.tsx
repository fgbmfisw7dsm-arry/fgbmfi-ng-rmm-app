import React from 'react';
import { User, Event } from '../types';

export const AppContext = React.createContext<{
  user: User | null;
  activeEventId: string;
  activeEvent: Event | null; // Full event object for status checking
  events: Event[]; // Shared global events list
  login: (u: User) => void;
  logout: () => void;
  onEventChange: (id: string) => void;
  refreshActiveEvent: () => void;
  refreshEvents: () => Promise<void>; // Global trigger to refresh list
}>({ 
  user: null, 
  activeEventId: '', 
  activeEvent: null,
  events: [],
  login: () => {}, 
  logout: () => {}, 
  onEventChange: () => {},
  refreshActiveEvent: () => {},
  refreshEvents: async () => {}
});