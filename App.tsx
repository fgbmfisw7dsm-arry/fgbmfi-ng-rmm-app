import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User, Event, UserRole } from './types';
import { AppContext } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigurationError } from './components/ConfigurationError';
import Layout from './components/Layout';
import { auth, db } from './services/supabaseService';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './hooks/useQueryClient';
import { flushQueueOnConnect } from './services/offlineQueue';

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
import SessionMinistryPage from './pages/SessionMinistryPage';
import BadgePrintingModule from './pages/BadgePrintingModule';
import StorageModule from './pages/StorageModule';
import AuditLogPage from './pages/AuditLogPage';
import ProtectedRoute from './components/ProtectedRoute';

const ALL_ADMIN_ROLES: UserRole[] = [
  UserRole.NATIONAL_ADMIN, UserRole.REGIONAL_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.ADMIN
];
const ADMIN_AND_REGISTRAR: UserRole[] = [
  ...ALL_ADMIN_ROLES,
  UserRole.NATIONAL_REGISTRAR, UserRole.REGIONAL_REGISTRAR, UserRole.DISTRICT_REGISTRAR, UserRole.REGISTRAR, UserRole.EXECUTIVE_ADMIN
];
const ADMIN_AND_FINANCE: UserRole[] = [
  ...ALL_ADMIN_ROLES, UserRole.FINANCE
];
const ADMIN_AND_EVENT_ADMIN: UserRole[] = [
  ...ALL_ADMIN_ROLES, UserRole.EVENT_ADMIN
];
const ADMIN_FINANCE_AND_EVENT_ADMIN: UserRole[] = [
  ...ADMIN_AND_FINANCE, UserRole.EVENT_ADMIN
];
const ADMIN_REGISTRAR_AND_EVENT_ADMIN: UserRole[] = [
  ...ADMIN_AND_REGISTRAR, UserRole.EVENT_ADMIN
];

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
           const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '', { app_metadata: session.user.app_metadata, user_metadata: session.user.user_metadata });
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
            const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '', { app_metadata: session.user.app_metadata, user_metadata: session.user.user_metadata });
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

  useEffect(() => {
    if (user?.id && activeEventId) {
      flushQueueOnConnect();
    }
  }, [user?.id, activeEventId]);

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
    <QueryClientProvider client={queryClient}>
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
                    <Route path="/admin/financials" element={
                      <ProtectedRoute allowedRoles={ADMIN_FINANCE_AND_EVENT_ADMIN}><FinancialsPage /></ProtectedRoute>
                    } />
                     <Route path="/checkin" element={
                       <ProtectedRoute allowedRoles={ADMIN_REGISTRAR_AND_EVENT_ADMIN}><CheckInPage /></ProtectedRoute>
                     } />
                     <Route path="/ministry" element={
                       <ProtectedRoute allowedRoles={ADMIN_REGISTRAR_AND_EVENT_ADMIN}><SessionMinistryPage /></ProtectedRoute>
                     } />
                     <Route path="/register-new" element={
                       <ProtectedRoute allowedRoles={ADMIN_REGISTRAR_AND_EVENT_ADMIN}><NewDelegatePage /></ProtectedRoute>
                    } />
                    <Route path="/admin/delegates" element={
                      <ProtectedRoute allowedRoles={ADMIN_AND_EVENT_ADMIN}><MasterListModule /></ProtectedRoute>
                    } />
                    <Route path="/admin/events" element={
                      <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><EventsModule /></ProtectedRoute>
                    } />
                    <Route path="/admin/users" element={
                      <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><UsersModule /></ProtectedRoute>
                    } />
                    <Route path="/admin/import" element={
                      <ProtectedRoute allowedRoles={ADMIN_AND_EVENT_ADMIN}><ImportModule /></ProtectedRoute>
                    } />
                    <Route path="/admin/setup" element={
                      <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><SetupModule /></ProtectedRoute>
                    } />
                     <Route path="/admin/data" element={
                       <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><DataModule /></ProtectedRoute>
                     } />
                     <Route path="/admin/storage" element={
                       <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><StorageModule /></ProtectedRoute>
                     } />
                     <Route path="/admin/audit" element={
                       <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><AuditLogPage /></ProtectedRoute>
                     } />
                     <Route path="/admin/badges" element={
                       <ProtectedRoute allowedRoles={ADMIN_AND_EVENT_ADMIN}><BadgePrintingModule /></ProtectedRoute>
                     } />
                     <Route path="/help" element={<UserManualModule />} />
                    <Route path="/" element={<Navigate to="/admin" replace />} />
                 </Routes>
              </Layout>
            } />
          )}
        </Routes>
      </HashRouter>
    </AppContext.Provider>
    </QueryClientProvider>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;