
// Enums for default seeding (System Defaults)
export enum Rank {
  CP = 'CP',
  FR = 'FR',
  ND = 'ND',
  CP_REP = 'CP-REP'
}

export enum Office {
  DC = 'DC',
  RVP = 'RVP',
  NVP = 'NVP',
  NP = 'NP',
  NEC = 'NEC',
  BOT = 'BOT',
  CP = 'CP',
  FR = 'FR',
  ND = 'ND',
  CP_REP = 'CP-REP',
  OTHER = 'OTHER'
}

export enum FinancialType {
  OFFERING = 'offering',
  PLEDGE_REDEMPTION = 'pledge_redemption'
}

export enum UserRole {
  ADMIN = 'admin',
  REGISTRAR = 'registrar',
  FINANCE = 'finance'
}

// Database Models
export interface Delegate {
  delegate_id: string;
  title: string;
  first_name: string;
  last_name: string;
  name_display: string;
  chapter: string;
  district: string;
  email: string;
  phone: string;
  rank: string;
  office: string;
  room_number: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  district?: string;
}

export interface Event {
  event_id: string;
  name: string;
  region: string;
  start_date: string;
  end_date: string;
}

export interface Session {
  session_id: string;
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
}

export interface CheckIn {
  checkin_id: string;
  event_id: string;
  delegate_id: string;
  session_id?: string;
  checked_in_at: string;
  checked_in_by: string;
  delegate_name?: string;
  district?: string;
  rank?: string;
  office?: string;
}

export interface CheckInResult {
  success: boolean;
  message?: string;
  code?: string;
  delegate?: Delegate;
}

export interface Pledge {
  id: string;
  event_id: string;
  donor_name: string;
  district: string;
  chapter: string;
  phone: string;
  email: string;
  amount_pledged: number;
  amount_redeemed: number;
  created_at: string;
}

export interface FinancialEntry {
  entry_id: string;
  event_id: string;
  session_id?: string;
  pledge_id?: string;
  amount: number;
  type: FinancialType;
  payer_name?: string;
  remarks: string;
  created_at: string;
}

export interface DashboardStats {
  totalDelegates: number;
  totalCheckIns: number;
  checkInsByRank: Record<string, number>;
  checkInsByDistrict: Record<string, number>;
  totalFinancials: number;
  recentActivity: CheckIn[];
}

export interface SystemSettings {
  districts: string[];
  ranks: string[];
  offices: string[];
  regions: string[];
  titles: string[];
}
