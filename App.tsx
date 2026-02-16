import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User, Event } from './types';
import { AppContext } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigurationError } from './components/ConfigurationError';
import Layout from './components/Layout';
import { auth, db } from './services/supabaseService';

// Modules
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import ReportsPage from './pages/ReportsPage';
import FinancialsPage from './pages/FinancialsPage';
import CheckInPage from './pages/CheckInPage';
import NewDelegatePage from './pages/NewDelegatePage';
import MasterListModule from './pages/MasterListModule';
import EventsModule from './pages/EventsModule';
import UsersModule from './pages/UsersModule';
import ImportModule from './pages/ImportModule';
import SetupModule from './pages/SetupModule';
import DataModule from './pages/DataModule';
import UserManualModule from './pages/UserManualModule';

const AppContent = () => {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [activeEventId, setActiveEventId] = useState<string>(() => localStorage.getItem('fgbmfi_active_event_id') || '');
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const userIdRef = useRef<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await db.getEvents();
      setEvents(data || []);
      
      if (activeEventId && !data.some(e => e.event_id === activeEventId)) {
        setActiveEventId('');
        setActiveEvent(null);
        localStorage.removeItem('fgbmfi_active_event_id');
      } else if (activeEventId) {
        const match = data.find(e => e.event_id === activeEventId);
        setActiveEvent(match || null);
      }
    } catch (e) {
      console.error("Failed to fetch events:", e);
    }
  }, [activeEventId, user?.id]);

  useEffect(() => {
    if (user?.id) {
        fetchEvents();
    }
  }, [fetchEvents, user?.id]);

  useEffect(() => {
    if (activeEventId) {
        localStorage.setItem('fgbmfi_active_event_id', activeEventId);
        const match = events.find(e => e.event_id === activeEventId);
        setActiveEvent(match || null);
    } else {
        localStorage.removeItem('fgbmfi_active_event_id');
        setActiveEvent(null);
    }
  }, [activeEventId, events]);

  const refreshActiveEvent = useCallback(async () => {
    await fetchEvents();
  }, [fetchEvents]);

  const logout = useCallback(async () => {
    userIdRef.current = null;
    setUser(null);
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.hash = "/login";
    } catch (e) {
      localStorage.clear();
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) setIsLoading(false);
        return;
      }

      // Safety Timeout: 5 seconds max for session check
      const timeoutId = setTimeout(() => {
        if (mounted && isLoading) {
          console.warn("Auth initialization timed out. Forcing ready state.");
          setIsLoading(false);
        }
      }, 5000);

      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) throw error;

        if (session?.user && mounted) {
           const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '');
           if (appUser && mounted) {
             userIdRef.current = appUser.id;
             setUser(appUser as User);
           }
        }
      } catch (err) {
        console.error("Auth initialization failed:", err);
      } finally {
        clearTimeout(timeoutId);
        if (mounted) setIsLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          userIdRef.current = null;
          if (mounted) setUser(null);
        } else if (event === 'SIGNED_IN' && session?.user) {
          if (userIdRef.current !== session.user.id) {
            const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '');
            if (mounted) {
              userIdRef.current = appUser.id;
              setUser(appUser as User);
            }
          }
        }
    });

    return () => { 
      mounted = false;
      subscription.unsubscribe(); 
    };
  }, []);

  if (!isSupabaseConfigured) return <ConfigurationError />;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6 shadow-xl"></div>
        <div className="text-center space-y-2">
            <p className="text-blue-900 text-xs font-black uppercase tracking-[0.2em] animate-pulse">Verifying Session...</p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Securing Cloud Link</p>
        </div>
        <button 
            onClick={() => setIsLoading(false)}
            className="mt-12 text-[9px] font-black text-gray-400 uppercase hover:text-blue-600 transition-colors border border-gray-200 px-6 py-3 rounded-full hover:bg-white hover:shadow-sm"
        >
            Skip Waiting
        </button>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ 
      user, 
      activeEventId, 
      activeEvent, 
      events,
      login: setUser, 
      logout, 
      onEventChange: setActiveEventId, 
      refreshActiveEvent,
      refreshEvents: fetchEvents 
    }}>
      <HashRouter>
        <Routes>
          {!user ? (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route path="*" element={
              <Layout user={user} onLogout={logout} activeEventId={activeEventId} onEventChange={setActiveEventId}>
                 <Routes>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/reports" element={<ReportsPage />} />
                    <Route path="/admin/financials" element={<FinancialsPage />} />
                    <Route path="/checkin" element={<CheckInPage />} />
                    <Route path="/register-new" element={<NewDelegatePage />} />
                    <Route path="/admin/delegates" element={<MasterListModule />} />
                    <Route path="/admin/events" element={<EventsModule />} />
                    <Route path="/admin/users" element={<UsersModule />} />
                    <Route path="/admin/import" element={<ImportModule />} />
                    <Route path="/admin/setup" element={<SetupModule />} />
                    <Route path="/admin/data" element={<DataModule />} />
                    <Route path="/help" element={<UserManualModule />} />
                    <Route path="/" element={<Navigate to="/admin" replace />} />
                 </Routes>
              </Layout>
            } />
          )}
        </Routes>
      </HashRouter>
    </AppContext.Provider>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;