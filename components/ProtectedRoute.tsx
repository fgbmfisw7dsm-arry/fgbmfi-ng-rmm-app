import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import { UserRole, isAdminRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

const getRoleLabel = (role: string): string => {
  switch (role.toLowerCase()) {
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

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { user } = useContext(AppContext);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const role = (user.role || '').toLowerCase();
  if (!allowedRoles.includes(role as UserRole)) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
        <div className="bg-white p-10 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-red-900 uppercase tracking-tight">Access Denied</h2>
          <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">
            Your account role ({getRoleLabel(role)}) does not have permission to access this feature.
          </p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.15em]">
            Contact your system administrator if you believe this is an error.
          </p>
          <a
            href="#/admin"
            className="inline-block mt-4 px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
