
import React, { useState, useEffect } from 'react';
import { User, UserRole, Event } from '../types';
import { Link, useLocation } from 'react-router-dom';
import { db } from '../services/supabaseService';

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  onLogout: () => void;
  activeEventId: string;
  onEventChange: (id: string) => void;
}

const MenuSection = ({ title, children }: { title: string, children?: React.ReactNode }) => (
  <div className="mb-6">
     <h4 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</h4>
     <div className="space-y-1">{children}</div>
  </div>
);

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout, activeEventId, onEventChange }) => {
  const location = useLocation();
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const fetchEvents = async () => {
        try {
            const data = await db.getEvents();
            setEvents(data);
        } catch(e) {}
    };
    fetchEvents();
  }, []);

  const isActive = (path: string) => location.pathname === path 
    ? "bg-blue-600 text-white shadow-md" 
    : "text-gray-300 hover:bg-gray-800 hover:text-white";

  const getRoleLabel = () => {
      // Handle potential case issues with role strings from database
      const role = (user.role || '').toLowerCase();
      switch(role) {
          case UserRole.ADMIN: return 'Regional Admin';
          case UserRole.FINANCE: return 'Financial Admin';
          case UserRole.REGISTRAR: 
            return user.district ? 'District Registrar' : 'Regional Registrar';
          default: return 'User';
      }
  };

  // --- REFINED ACCESS CONTROL ---
  const role = (user.role || '').toLowerCase();
  
  // Operations: Admin, Registrar, Finance (Financial Admin)
  const showOperations = role === UserRole.ADMIN || role === UserRole.REGISTRAR || role === UserRole.FINANCE;
  
  // Administration: ONLY Regional Admin
  const showAdminTools = role === UserRole.ADMIN;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row print:bg-white">
      <aside className="w-full md:w-64 bg-slate-900 text-white flex-shrink-0 no-print flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold tracking-tight text-white leading-tight">FGBMFI Nigeria</h1>
          <p className="text-xs text-gray-400 mt-1">{getRoleLabel()}</p>
          {user.district && <p className="text-xs text-blue-400 mt-0.5 font-bold uppercase">{user.district} District</p>}
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <MenuSection title="General">
             <Link to="/admin" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin')}`}>
               Dashboard
             </Link>
             <Link to="/admin/reports" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/reports')}`}>
                 Reports
             </Link>
          </MenuSection>

          <MenuSection title="Operations">
             {showOperations && (
                <>
                  <Link to="/checkin" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/checkin')}`}>
                    Check-In
                  </Link>
                  <Link to="/register-new" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/register-new')}`}>
                    New Delegate
                  </Link>
                  <Link to="/admin/financials" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/financials')}`}>
                     Financials
                  </Link>
                </>
             )}
          </MenuSection>

          {showAdminTools && (
            <MenuSection title="Administration">
               <Link to="/admin/delegates" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/delegates')}`}>
                 Master List
               </Link>
               <Link to="/admin/events" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/events')}`}>
                 Events & Config
               </Link>
               <Link to="/admin/users" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/users')}`}>
                 User Management
               </Link>
               <Link to="/admin/import" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/import')}`}>
                 Import Data
               </Link>
               <Link to="/admin/setup" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/setup')}`}>
                 System Setup
               </Link>
               <Link to="/admin/data" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/data')}`}>
                 Data Management
               </Link>
            </MenuSection>
          )}

          <MenuSection title="System Support">
             <Link to="/help" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/help')}`}>
               User Manual
             </Link>
          </MenuSection>
        </nav>

        <div className="p-4 border-t border-gray-800">
           <button onClick={onLogout} className="w-full flex items-center gap-2 px-4 py-2 text-red-400 hover:text-red-300 transition-colors rounded-lg hover:bg-gray-800">
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
             <span className="text-sm font-medium">Sign Out</span>
           </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b border-gray-200 p-4 flex justify-between items-center no-print">
           <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-tighter">Event Context:</span>
              <select 
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block p-2.5 min-w-[220px] font-bold"
                value={activeEventId}
                onChange={e => onEventChange(e.target.value)}
              >
                <option value="" disabled>-- Select Event --</option>
                {events.map(e => (
                  <option key={e.event_id} value={e.event_id}>{e.name}</option>
                ))}
              </select>
           </div>
           <div className="flex items-center gap-2">
              <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{user.email}</p>
                  <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">{getRoleLabel()}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-black border-2 border-white shadow-sm">
                 {(user.email || 'U').charAt(0).toUpperCase()}
              </div>
           </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
