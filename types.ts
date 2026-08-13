
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
  NATIONAL_ADMIN = 'national_admin',
  REGIONAL_ADMIN = 'regional_admin',
  DISTRICT_ADMIN = 'district_admin',
  NATIONAL_REGISTRAR = 'national_registrar',
  REGIONAL_REGISTRAR = 'regional_registrar',
  DISTRICT_REGISTRAR = 'district_registrar',
  ADMIN = 'admin',
  REGISTRAR = 'registrar',
  FINANCE = 'finance',
  EVENT_ADMIN = 'event_admin'
}

export const isAdminRole = (role: string): boolean =>
  role === UserRole.NATIONAL_ADMIN || role === UserRole.REGIONAL_ADMIN || role === UserRole.DISTRICT_ADMIN || role === UserRole.ADMIN;

export const isRegistrarRole = (role: string): boolean =>
  role === UserRole.NATIONAL_REGISTRAR || role === UserRole.REGIONAL_REGISTRAR || role === UserRole.DISTRICT_REGISTRAR || role === UserRole.REGISTRAR;

export const isEventAdminRole = (role: string): boolean =>
  role === UserRole.EVENT_ADMIN;

export const isNationalRole = (role: string): boolean =>
  role === UserRole.NATIONAL_ADMIN || role === UserRole.NATIONAL_REGISTRAR;

export const isRegionalRole = (role: string): boolean =>
  role === UserRole.REGIONAL_ADMIN || role === UserRole.REGIONAL_REGISTRAR;

export const isDistrictRole = (role: string): boolean =>
  role === UserRole.DISTRICT_ADMIN || role === UserRole.DISTRICT_REGISTRAR || role === UserRole.REGISTRAR;

export const getScopeFilter = (user: { role?: string; district?: string; region?: string } | null): { district?: string; region?: string } => {
  if (!user) return {};
  const role = (user.role || '').toLowerCase();
  if (isAdminRole(role) || isEventAdminRole(role) || role === UserRole.FINANCE) return {};
  if (isNationalRole(role)) return {};
  if (isRegionalRole(role)) return user.region ? { region: user.region } : {};
  return user.district ? { district: user.district } : {};
};

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
  delegate_type: string;
  room_number: string;
  qr_hash: string;
  external_id: string;
  event_id: string;
  registration_source: 'import' | 'manual' | 'qr_scan';
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  district?: string;
  region?: string;
  is_active?: boolean;
}

export interface Event {
  event_id: string;
  name: string;
  region: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  event_config?: Record<string, boolean | string[]>;
}

export interface Session {
  session_id: string;
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
}

export interface Chapter {
  chapter_id: string;
  district: string;
  chapter_code: string;
  chapter_name: string;
  state: string;
  city: string;
  meeting_day: string;
  is_active: boolean;
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
  needsRegistration?: boolean;
  scannedCode?: string;
  parsedData?: Record<string, string> | null;
  alreadyCheckedIn?: boolean;
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
  pledge_name?: string;
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
  totalArrivals: number;
  totalSessionAttendance: number;
  checkInsByRank: Record<string, number>;
  checkInsByDistrict: Record<string, number>;
  totalFinancials: number;
  recentActivity: CheckIn[];
}

export interface SystemSettings {
  id?: any;
  districts: string[];
  ranks: string[];
  offices: string[];
  regions: string[];
  titles: string[];
  delegate_types: string[];
  audit_enabled?: boolean;
}

export enum SessionResponseType {
  FT = 'FT',
  SLV = 'SLV',
  HGB = 'HGB',
  MI = 'MI'
}

export const RESPONSE_TYPE_LABELS: Record<SessionResponseType, string> = {
  [SessionResponseType.FT]: 'First Timers',
  [SessionResponseType.SLV]: 'Salvation',
  [SessionResponseType.HGB]: 'Holy Ghost Baptism',
  [SessionResponseType.MI]: 'Membership Intention'
};

export interface SessionResponse {
  response_id: string;
  event_id: string;
  delegate_id: string;
  session_id: string;
  response_type: SessionResponseType;
  recorded_at: string;
  recorded_by: string;
  first_name?: string;
  last_name?: string;
  district?: string;
  chapter?: string;
  phone?: string;
  rank?: string;
  office?: string;
  delegate_name?: string;
  session_title?: string;
}

export interface SessionResponseSummary {
  id: string;
  session_id: string;
  event_id: string;
  response_type: SessionResponseType;
  total_count: number;
  entered_by: string;
  entered_at: string;
  session_title?: string;
}

export interface VoiceDistribution {
  id: string;
  event_id: string;
  session_id: string;
  total_distributed: number;
  updated_at: string;
  updated_by: string;
  session_title?: string;
}

export interface SessionMinistryDashboard {
  session_id: string;
  session_title: string;
  start_time: string;
  end_time: string;
  attendance: number;
  ft_count: number;
  slv_count: number;
  hgb_count: number;
  mi_count: number;
  ft_summary: number;
  slv_summary: number;
  hgb_summary: number;
  mi_summary: number;
  voice_distribution: number;
}

export interface MinistryExportData {
  responses: SessionResponse[];
  summaries: SessionResponseSummary[];
  voiceDistribution: VoiceDistribution[];
  attendance: { session_id: string; session_title: string; attendance: number }[];
}

export type BadgeLayout = '8-up' | '10-up' | '6-up-portrait' | '9-up-portrait' | '8-up-portrait' | '4-up-3x4';
export type BadgeBatchSize = 250 | 500 | 1000;
export type BatchStatus = 'pending' | 'generating' | 'ready' | 'printing' | 'printed' | 'failed';
export type BadgeSortField = 'delegate_number' | 'surname' | 'district' | 'chapter' | 'category' | 'registration_date';
export type BadgePrintAction = 'generated' | 'reprinted' | 'replaced_lost';

export interface BadgeFilter {
  district?: string;
  chapter?: string;
  delegateType?: string;
  registrationStatus?: 'checked_in' | 'not_checked_in' | 'all';
  delegateNumberFrom?: string;
  delegateNumberTo?: string;
  surnameFrom?: string;
  surnameTo?: string;
  selectedIds?: string[];
}

export interface BadgeBatch {
  batch_id: string;
  event_id: string;
  batch_number: number;
  badge_count: number;
  page_count: number;
  layout: BadgeLayout;
  sort_field: BadgeSortField;
  filters: BadgeFilter;
  status: BatchStatus;
  pdf_url: string | null;
  generated_by: string;
  generated_at: string | null;
  created_at: string;
}

export interface BadgePrintLog {
  log_id: string;
  batch_id: string | null;
  event_id: string;
  delegate_id: string;
  action: BadgePrintAction;
  performed_by: string;
  performed_by_email?: string;
  delegate_name?: string;
  created_at: string;
}

export interface BadgeGenerationProgress {
  current: number;
  total: number;
  phase: 'generating_qr' | 'composing_pages' | 'saving';
}

export interface BadgeLayoutConfig {
  cols: number;
  rows: number;
  badgeW: number;
  badgeH: number;
  cutGap: number;
}

export interface AuditLog {
  id: number;
  event_id: string;
  action_type: string;
  performed_by: string;
  performer_email?: string;
  target_type?: string;
  target_id?: string;
  summary: string;
  metadata?: Record<string, any>;
  created_at: string;
}
