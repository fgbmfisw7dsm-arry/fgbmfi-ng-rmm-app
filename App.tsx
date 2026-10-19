import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User, Event, UserRole, LogoutReason } from './types';
import { AppContext } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigurationError } from './components/ConfigurationError';
import Layout from './components/Layout';
import { auth, db } from './services/supabaseService';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './hooks/useQueryClient';
import { flushQueueOnConnect } from './services/offlineQueue';
import { setOfflineSession, refreshOfflineWindow } from './services/offlineRoster';
import { defaultRouteForRole } from './services/roleRouting';
import { startPresence, stopPresence, getDeviceId } from './services/presenceService';import { useIdleTimeout } from './hooks/useIdleTimeout';
import IdleTimeoutModal from './components/IdleTimeoutModal';

// Modules — LoginPage stays eager for first paint; the rest are route-level
// code-split so heavy deps (recharts, pdf-lib, qrcode) load only when needed.
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';

const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const ReportsPage = React.lazy(() => import('./pages/ReportsPage'));
const FinancialsPage = React.lazy(() => import('./pages/FinancialsPage'));
const CheckInPage = React.lazy(() => import('./pages/CheckInPage'));
const NewDelegatePage = React.lazy(() => import('./pages/NewDelegatePage'));
const MasterListModule = React.lazy(() => import('./pages/MasterListModule'));
const EventsModule = React.lazy(() => import('./pages/EventsModule'));
const UsersModule = React.lazy(() => import('./pages/UsersModule'));
const ImportModule = React.lazy(() => import('./pages/ImportModule'));
const SetupModule = React.lazy(() => import('./pages/SetupModule'));
const DataModule = React.lazy(() => import('./pages/DataModule'));
const UserManualModule = React.lazy(() => import('./pages/UserManualModule'));
const SessionMinistryPage = React.lazy(() => import('./pages/SessionMinistryPage'));
const BadgePrintingModule = React.lazy(() => import('./pages/BadgePrintingModule'));
const IndividualBadgePrint = React.lazy(() => import('./pages/IndividualBadgePrint'));
const StorageModule = React.lazy(() => import('./pages/StorageModule'));
const AuditLogPage = React.lazy(() => import('./pages/AuditLogPage'));
const ConnectedUsersPage = React.lazy(() => import('./pages/ConnectedUsersPage'));

const PageFallback = () => (
  <div className="p-20 text-center flex flex-col items-center gap-4 opacity-60">
    <div className="w-8 h-8 border-4 border-blue-900 border-t-transparent rounded-full animate-spin" />
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Loading…</p>
  </div>
);

const ALL_ADMIN_ROLES: UserRole[] = [
  UserRole.NATIONAL_ADMIN, UserRole.REGIONAL_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.ADMIN
];
const ADMIN_AND_REGISTRAR: UserRole[] = [
  ...ALL_ADMIN_ROLES,
  UserRole.NATIONAL_REGISTRAR, UserRole.REGIONAL_REGISTRAR, UserRole.DISTRICT_REGISTRAR, UserRole.REGISTRAR, UserRole.EXECUTIVE_ADMIN, UserRole.EXEC_REGISTRAR
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
// v1.65: Individual Delegate Badge printing — admins + Exec Registrar + Event Admin.
const ADMIN_EXEC_REGISTRAR_AND_EVENT_ADMIN: UserRole[] = [
  ...ALL_ADMIN_ROLES, UserRole.EXEC_REGISTRAR, UserRole.EVENT_ADMIN
];

// v1.73: offline queue keys must survive a logout so pending check-ins are not
// silently lost; everything else (active event, caches) is cleared. Auth tokens
// are managed by Supabase under its own storage key.
const PRESERVED_LOGOUT_KEYS = ['fgbmfi_checkin_queue', 'fgbmfi_session_response_queue', 'fgbmfi_session_aggregate_queue'];
const clearLocalStorageExceptQueues = () => {
  try {
    const saved: Record<string, string> = {};
    PRESERVED_LOGOUT_KEYS.forEach((k) => {
      const v = localStorage.getItem(k);
      if (v != null) saved[k] = v;
    });
    localStorage.clear();
    Object.entries(saved).forEach(([k, v]) => localStorage.setItem(k, v));
  } catch { /* ignore */ }
};

const AppContent = () => {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [activeEventId, setActiveEventId] = useState<string>(() => localStorage.getItem('fgbmfi_active_event_id') || '');
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [liveEventId, setLiveEventId] = useState<string | null>(null);
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

  // v1.82: server-side live event pin. When pinned, every client is forced onto
  // that event and the selector is locked for all roles.
  const refreshLiveEvent = useCallback(async () => {
    if (!user?.id) {
      setLiveEventId(null);
      return;
    }
    const id = await db.getLiveEventId();
    setLiveEventId(id);
    if (id) setActiveEventId(id);
  }, [user?.id]);

  const unpinLiveEvent = useCallback(async () => {
    try {
      await db.setLiveEvent(null);
      setLiveEventId(null);
    } catch (e: any) {
      alert(e?.message || 'Unable to unpin the live event.');
    }
  }, []);

  const handleEventChange = useCallback((id: string) => {
    if (liveEventId) return;
    setActiveEventId(id);
  }, [liveEventId]);

  useEffect(() => {
    void refreshLiveEvent();
  }, [refreshLiveEvent]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('live_event_config')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'system_settings' },
        () => { void refreshLiveEvent(); })
      .subscribe();

    const sync = () => { void refreshLiveEvent(); };
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    const interval = setInterval(sync, 60_000);

    return () => {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      clearInterval(interval);
    };
  }, [user?.id, refreshLiveEvent]);

  const logout = useCallback(async () => {
    userIdRef.current = null;
    try { stopPresence(); } catch { /* ignore */ }
    setOfflineSession(null);
    setUser(null);
    try {
      // v1.73: local scope — on a shared login, this device only. Global scope
      // (the Supabase default) would revoke the whole account's sessions.
      await supabase.auth.signOut({ scope: 'local' });
      // Preserve offline queues; remove everything else.
      clearLocalStorageExceptQueues();
      window.location.hash = "/login";
    } catch (e) {
      clearLocalStorageExceptQueues();
      window.location.reload();
    }
  }, []);

  const logoutWithReason = useCallback((reason: LogoutReason) => {
    try { sessionStorage.setItem('fgbmfi_logout_reason', reason); } catch { /* ignore */ }
    logout();
  }, [logout]);

  // v1.73 — idle timeout (per device; 15 min + 60s warning).
  const { warning: idleWarning, secondsLeft: idleSeconds, stayActive, signOutNow } = useIdleTimeout({
    enabled: !!user?.id,
    onIdle: () => logoutWithReason('inactivity'),
  });

  // v1.73 — presence + kick consumer (shared-login aware).
  useEffect(() => {
    if (!user?.id) { stopPresence(); return; }
    const myDeviceId = getDeviceId();

    const shouldHonor = (deviceId?: string | null) => !deviceId || deviceId === myDeviceId;
    const seenKicks = new Set<string>();
    const markSeen = (id: string) => {
      try {
        const raw = sessionStorage.getItem('fgbmfi_seen_kicks');
        const arr: string[] = raw ? JSON.parse(raw) : [];
        if (!arr.includes(id)) { arr.push(id); sessionStorage.setItem('fgbmfi_seen_kicks', JSON.stringify(arr.slice(-50))); }
      } catch { /* ignore */ }
    };
    try {
      const raw = sessionStorage.getItem('fgbmfi_seen_kicks');
      (raw ? JSON.parse(raw) : []).forEach((id: string) => seenKicks.add(id));
    } catch { /* ignore */ }

    startPresence(user, activeEventId || undefined);

    const honor = async (kick: any) => {
      if (!kick?.id || seenKicks.has(kick.id)) return;
      seenKicks.add(kick.id);
      markSeen(kick.id);
      await db.consumeKick(kick.id);
      logoutWithReason(kick.device_id ? 'disconnected' : 'disconnected-all');
    };

    // Catch kicks issued while this device was offline.
    db.getRecentKicks(user.id).then((kicks) => {
      kicks.filter((k) => !k.consumed_at && shouldHonor(k.device_id)).forEach((k) => { void honor(k); });
    }).catch(() => {});

    const kickChannel = supabase
      .channel(`kicks_${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'session_kicks', filter: `user_id=eq.${user.id}` },
        (payload) => { const k: any = payload.new; if (shouldHonor(k?.device_id)) void honor(k); })
      .subscribe();

    return () => {
      stopPresence();
      try { supabase.removeChannel(kickChannel); } catch { /* ignore */ }
    };
  }, [user?.id, activeEventId, logoutWithReason]);

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
          try { stopPresence(); } catch { /* ignore */ }
          setOfflineSession(null);
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

  // v1.86: bind the encrypted offline cache and write queues to this account +
  // scope. The offline window is time-bounded (24h) and refreshed by successful
  // syncs/reconnects. This effect must run before the queue flusher below so the
  // owner id is available when pending writes are replayed.
  useEffect(() => {
    setOfflineSession(user ? {
      id: user.id,
      role: user.role,
      district: user.district,
      region: user.region,
    } : null);
    if (!user?.id) return;
    const refresh = () => refreshOfflineWindow();
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [user?.id, user?.role, user?.district, user?.region]);

  // v1.82: pending queues are flushed globally, but only for items owned by the
  // currently authenticated account (offlineQueue enforces the owner check).
  useEffect(() => {
    if (!user?.id) return;
    flushQueueOnConnect();
    const sync = () => { refreshOfflineWindow(); flushQueueOnConnect(); };
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [user?.id]);

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
      liveEventId,
      login: setUser, 
      logout, 
      onEventChange: handleEventChange, 
      refreshActiveEvent,
      refreshEvents: fetchEvents,
      refreshLiveEvent
    }}>
      {user?.id && idleWarning && (
        <IdleTimeoutModal secondsLeft={idleSeconds} onStay={stayActive} onSignOut={signOutNow} />
      )}
      <HashRouter>
        <Routes>
          {!user ? (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route path="*" element={
              <Layout
                user={user}
                onLogout={logout}
                activeEventId={activeEventId}
                onEventChange={handleEventChange}
                liveEventPinned={!!liveEventId}
                onUnpinLiveEvent={unpinLiveEvent}
              >
                 <Suspense fallback={<PageFallback />}>
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
                    <Route path="/print-badge" element={
                       <ProtectedRoute allowedRoles={ADMIN_EXEC_REGISTRAR_AND_EVENT_ADMIN}><IndividualBadgePrint /></ProtectedRoute>
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
                     <Route path="/admin/connections" element={
                       <ProtectedRoute allowedRoles={ALL_ADMIN_ROLES}><ConnectedUsersPage /></ProtectedRoute>
                     } />
                     <Route path="/admin/badges" element={
                       <ProtectedRoute allowedRoles={ADMIN_AND_EVENT_ADMIN}><BadgePrintingModule /></ProtectedRoute>
                     } />
                     <Route path="/help/:section?" element={<UserManualModule />} />
                    <Route path="/" element={<Navigate to={defaultRouteForRole(user.role)} replace />} />
                 </Routes>
                 </Suspense>
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