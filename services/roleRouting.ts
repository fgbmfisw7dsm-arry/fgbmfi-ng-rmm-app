import { UserRole, isAdminRole, isEventAdminRole, isRegistrarRole } from '../types';

// v1.82: operational landing page per role. Used after login and for the empty
// "/" route. Deep links entered directly are still honored.
export function defaultRouteForRole(role?: string | null): string {
  const r = (role || '').toLowerCase();

  if (r === UserRole.FINANCE) return '/admin/financials';
  if (r === UserRole.EXEC_REGISTRAR) return '/register-new';
  if (isAdminRole(r) || isEventAdminRole(r) || r === UserRole.EXECUTIVE_ADMIN) return '/admin';
  if (isRegistrarRole(r)) return '/checkin';
  return '/admin';
}
