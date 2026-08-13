import React, { useContext } from 'react';
import { User, UserRole, isAdminRole, isRegistrarRole, isEventAdminRole, isNationalRole, isRegionalRole, isDistrictRole } from '../types';
import { Link, useLocation } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import ConnectionStatus from './ConnectionStatus';

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
  const { activeEvent, events } = useContext(AppContext);

  const isActive = (path: string) => location.pathname === path 
    ? "bg-blue-600 text-white shadow-md" 
    : "text-gray-300 hover:bg-gray-800 hover:text-white";

const getRoleLabel = () => {
       const role = (user.role || '').toLowerCase();
       switch(role) {
           case UserRole.NATIONAL_ADMIN: return 'National Admin';
           case UserRole.REGIONAL_ADMIN: return 'Regional Admin';
           case UserRole.DISTRICT_ADMIN: return 'District Admin';
           case UserRole.NATIONAL_REGISTRAR: return 'National Registrar';
           case UserRole.REGIONAL_REGISTRAR: return 'Regional Registrar';
           case UserRole.DISTRICT_REGISTRAR: return 'District Registrar';
            case UserRole.ADMIN: return 'System Admin';
            case UserRole.REGISTRAR: return 'Registrar';
           case UserRole.FINANCE: return 'Finance Admin';
           case UserRole.EVENT_ADMIN: return 'Event Admin';
           default: return 'User';
       }
   };

   const role = (user.role || '').toLowerCase();
   const adminRole = isAdminRole(role);
   const registrarRole = isRegistrarRole(role);
   const eventAdminRole = isEventAdminRole(role);
   const showAdminTools = adminRole;
   const showFinanceModule = adminRole || role === UserRole.FINANCE;
   const showCheckInModule = adminRole || registrarRole || eventAdminRole;
   const showBadgeModule = adminRole || eventAdminRole;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row print:bg-white">
      <aside className="w-full md:w-64 bg-slate-900 text-white flex-shrink-0 no-print flex flex-col shadow-2xl">
        <div className="p-8 border-b border-gray-800 flex flex-col items-center text-center">
          <img src="/logo-fgbmfi.png" alt="FGBMFI Logo" className="h-32 w-auto mb-6 drop-shadow-[0_10px_15px_rgba(255,255,255,0.1)] transition-transform hover:scale-105 duration-300" />
          <h1 className="text-xl font-black tracking-tight text-white leading-tight uppercase">FGBMFI Nigeria</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mt-2">Event Management System</p>
           {user.district && isDistrictRole(role) && <p className="text-[9px] text-blue-400 mt-1 font-black uppercase tracking-tighter">{user.district} District</p>}
           {user.region && isRegionalRole(role) && <p className="text-[9px] text-emerald-400 mt-1 font-black uppercase tracking-tighter">{user.region} Region</p>}
          <button onClick={onLogout} className="mt-4 flex items-center gap-1.5 text-gray-400 hover:text-red-400 transition-colors text-[10px] font-bold uppercase tracking-wider" title="Sign Out">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Sign Out
          </button>
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
             {showCheckInModule && (
                <>
                  <Link to="/checkin" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/checkin')}`}>
                    Check-In
                  </Link>
                  <Link to="/ministry" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/ministry')}`}>
                    Session Details
                  </Link>
                  <Link to="/register-new" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/register-new')}`}>
                    New Delegate
                  </Link>
                </>
             )}
             {showBadgeModule && (
                <Link to="/admin/badges" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/badges')}`}>
                  Badge Printing
                </Link>
             )}
             {showFinanceModule && (
                <Link to="/admin/financials" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/financials')}`}>
                   Financials
                </Link>
             )}
          </MenuSection>

          {eventAdminRole && !adminRole && (
            <MenuSection title="Delegates">
               <Link to="/admin/delegates" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/delegates')}`}>
                 Master List
               </Link>
            </MenuSection>
          )}

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
                <Link to="/admin/storage" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/storage')}`}>
                  Storage
                </Link>
                <Link to="/admin/audit" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/admin/audit')}`}>
                  Audit Log
                </Link>
            </MenuSection>
          )}

          <MenuSection title="System Support">
             <Link to="/help" className={`block px-4 py-2 mx-2 rounded-lg transition-colors text-sm font-medium ${isActive('/help')}`}>
               User Manual
             </Link>
          </MenuSection>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b border-gray-200 p-4 flex justify-between items-center no-print">
           <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-tighter">Event Context:</span>
              <div className="flex items-center gap-2">
                <select 
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block p-2.5 min-w-[220px] font-bold"
                    value={activeEventId}
                    onChange={e => onEventChange(e.target.value)}
                >
                    <option value="">-- Select Event --</option>
                    {events.map(e => (
                    <option key={e.event_id} value={e.event_id}>{e.name}</option>
                    ))}
                </select>
                {activeEvent && (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase transition-all ${activeEvent.is_active ? 'bg-green-50 text-green-700 border-green-200 shadow-sm' : 'bg-red-50 text-red-700 border-red-200 shadow-sm'}`}>
                        <span className={`w-2 h-2 rounded-full ${activeEvent.is_active ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                        {activeEvent.is_active ? 'Live' : 'Locked'}
                    </div>
                )}
              </div>
           </div>
            <div className="flex items-center gap-2">
               <ConnectionStatus />
               <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{user.email}</p>
                  <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">{getRoleLabel()}</p>
              </div>
                 <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-black border-2 border-white shadow-sm">
                   {(user.email || 'U').charAt(0).toUpperCase()}
                </div>
                <button onClick={onLogout} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Sign Out">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
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