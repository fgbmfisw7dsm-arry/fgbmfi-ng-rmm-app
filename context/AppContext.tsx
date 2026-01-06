
import React from 'react';
import { User } from '../types';

export const AppContext = React.createContext<{
  user: User | null;
  activeEventId: string;
  login: (u: User) => void;
  logout: () => void;
  onEventChange: (id: string) => void;
}>({ 
  user: null, 
  activeEventId: '', 
  login: () => {}, 
  logout: () => {}, 
  onEventChange: () => {} 
});
