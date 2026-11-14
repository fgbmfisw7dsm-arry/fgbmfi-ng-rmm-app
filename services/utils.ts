export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN'
    }).format(amount);
};

/**
 * HTML-escapes a value for safe interpolation into innerHTML string builders
 * (PDF export tables and any DOM innerHTML assignment).
 */
export const escapeHtml = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Generates a UUID v4 for QR hash (primary identifier).
 * Used when creating new delegates or regenerating lost badges.
 */
export const generateQrHash = (): string => {
    return crypto.randomUUID();
};

export const generateRegId = (): string => {
    const now = new Date();
    const ts = [
        now.getMonth() + 1,
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds()
    ].map(n => String(n).padStart(2, '0')).join('');

    const hexChars = '0123456789abcdef';
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(10)))
        .map(b => hexChars[b & 0x0f]).join('');

    return `CON26${ts}${suffix}`;
};

export const REGION_PREFIXES: Record<string, string> = {
    'NC': 'North Central', 'NE': 'North East', 'NW': 'North West',
    'SE': 'South East', 'SS': 'South South', 'SW': 'South West',
};

export const FULL_REGION_PREFIXES: Record<string, string> = {
    'NORTHCENTRAL': 'North Central', 'NORTHEAST': 'North East', 'NORTHWEST': 'North West',
    'SOUTHEAST': 'South East', 'SOUTHSOUTH': 'South South', 'SOUTHWEST': 'South West',
};

export const districtAliasKey = (v?: string | null): string =>
    (v || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/[^A-Z0-9]/g, '');

// Explicit district aliases: labels used in source CSVs that must resolve to
// an official FGBMFI district. Extend here as new state/zone labels appear.
export const DISTRICT_ALIASES: Record<string, string> = {
    'ANAMBRA': 'South East 1',
};

// Resolves a district value to its official name. Handles the region short
// codes (NC1, SW 2, ...), the 'D' variant (SED 1), and the full
// 'REGION DISTRICT N' spelling (SOUTH EAST DISTRICT 1), plus explicit aliases
// (Anambra -> South East 1).
export const resolveDistrictAlias = (raw?: string | null): string | null => {
    const key = districtAliasKey(raw || '');
    if (!key) return null;
    const short = key.match(/^(NC|NE|NW|SE|SS|SW)D?(?:DISTRICT)?(\d+)$/);
    if (short) return `${REGION_PREFIXES[short[1]]} ${short[2].replace(/^0+/, '')}`;
    const full = key.match(/^(NORTHCENTRAL|NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHSOUTH|SOUTHWEST)(?:DISTRICT)?(\d+)$/);
    if (full) return `${FULL_REGION_PREFIXES[full[1]]} ${full[2].replace(/^0+/, '')}`;
    return DISTRICT_ALIASES[key] || null;
};

export const normDistrictKey = (v?: string | null): string =>
    (v || '').replace(/\s+/g, ' ').trim().toUpperCase();

// Legacy guest-district labels that were hard-coded in past versions (v1.39–v1.48).
// Used to map any remaining stored rows to the currently-configured labels.
export const LEGACY_GUEST_DISTRICT_RE = /NATIONAL\/EXTERNAL|INTERNATIONAL\/EXTERNAL|INTERNATIONAL\/GUEST/i;

// Maps a STORED delegate.district value to a configured label so Master List rows
// and section headers always agree with System Setup. delegateType routes legacy
// guest labels correctly after the Guest / International split (v1.50).
export const resolveDistrictLabel = (
    raw?: string | null,
    districts?: string[],
    typeMap?: Record<string, string>,
    delegateType?: string
): string => {
    const stored = (raw || '').trim();
    if (!stored) return stored;
    const key = normDistrictKey(stored);
    const official = (districts || []).find(d => normDistrictKey(d) === key);
    if (official) return official;
    if (LEGACY_GUEST_DISTRICT_RE.test(stored)) {
        const t = (delegateType || '').trim().toUpperCase();
        const intl = ((typeMap || {})['International'] || '').trim();
        if (t === 'INTERNATIONAL' && intl) return intl;
        const guest = ((typeMap || {})['Free Guest'] || (typeMap || {})['National Guest'] || '').trim();
        if (guest) return guest;
    }
    return stored;
};

export const resolveDistrictShortCode = (raw?: string | null): string => {
    const trimmed = (raw || '').trim();
    let v = trimmed;
    const dashIdx = v.indexOf('-');
    if (dashIdx > 0) {
        const prefix = v.substring(0, dashIdx);
        const suffix = v.substring(dashIdx + 1);
        if (/^\d+$/.test(suffix) && /^[A-Z]{2}\d+$/i.test(prefix)) v = prefix.toUpperCase();
    }
    return resolveDistrictAlias(v || trimmed) || trimmed;
};

// The registration portal emits its own enum spellings for delegate types
// (`MEMBER_DELEGATE`, `DEPENDANT_DELEGATE`, `PAID_GUEST`, `NONPAYMENT_GUEST`,
// `INTERNATIONAL_GUEST`). Imports must store the canonical EMS type so the
// Master List Type filter, reports and badge band colours keep working.
// Unknown values pass through untouched (and are surfaced as a warning in the
// import preview) rather than silently becoming "Member".
export const DELEGATE_TYPE_ALIASES: Record<string, string> = {
    'PAID GUEST': 'National Guest',
    'PAYING GUEST': 'National Guest',
    'FEE PAYING GUEST': 'National Guest',
    'NATIONAL GUEST': 'National Guest',
    'NONPAYMENT GUEST': 'Free Guest',
    'NON PAYMENT GUEST': 'Free Guest',
    'FREE GUEST': 'Free Guest',
    'INTERNATIONAL GUEST': 'International',
    'FOREIGN GUEST': 'International',
    'INTERNATIONAL': 'International',
    'MEMBER DELEGATE': 'Member',
    'MEMBER': 'Member',
    'DEPENDANT DELEGATE': 'Dependant-Adult',
    'DEPENDENT DELEGATE': 'Dependant-Adult',
    'DEPENDANT': 'Dependant-Adult',
    'DEPENDENT': 'Dependant-Adult',
};

const delegateTypeKey = (raw?: string | null): string =>
    (raw || '').trim().toUpperCase().replace(/[_\-\s]+/g, ' ').trim();

export const normalizeDelegateType = (raw?: string | null, knownTypes: string[] = []): string => {
    const original = (raw || '').trim();
    if (!original) return '';
    const key = delegateTypeKey(original);
    if (DELEGATE_TYPE_ALIASES[key]) return DELEGATE_TYPE_ALIASES[key];
    const exact = knownTypes.find(t => delegateTypeKey(t) === key);
    if (exact) return exact;
    // `X_DELEGATE` / `X GUEST` → match the stem against the configured types so
    // a future portal category (e.g. FACILITATOR_DELEGATE) needs no code change.
    const stem = key.replace(/\s+(DELEGATE|DELEGATES)$/, '').trim();
    if (stem && stem !== key) {
        if (DELEGATE_TYPE_ALIASES[stem]) return DELEGATE_TYPE_ALIASES[stem];
        const matched = knownTypes.find(t => delegateTypeKey(t) === stem);
        if (matched) return matched;
    }
    return original;
};

// District spreadsheets commonly stamp the chapter's official code onto the
// chapter cell ("GRA (SW4-0123)"). That code is `chapters.chapter_code`, not
// part of the name, so imports store only the name. Only the code shape
// `XXn-dddd` is removed; meaningful parentheticals like "(ngc)" or "(FRSC)"
// survive untouched.
export const CHAPTER_CODE_PATTERN = '[A-Z]{2,4}\\s*\\d{0,2}\\s*-\\s*\\d{3,4}';
export const CHAPTER_CODE_RE = new RegExp(CHAPTER_CODE_PATTERN, 'i');

// Returns the normalised code found in a chapter cell ('' when none), so
// callers can detect a coded chapter without duplicating the pattern.
export const chapterCodeOf = (raw?: string | null): string => {
    const t = (raw || '').replace(/\s+/g, ' ').trim();
    const m = t.match(CHAPTER_CODE_RE);
    return m ? m[0].replace(/\s+/g, '').toUpperCase() : '';
};

const stripChapterCodes = (value: string): string => {
    let out = value;
    // Repeated so double-stamped cells ("GRA (SW4-0123) [SW4-0123]") fully clean.
    for (let pass = 0; pass < 4; pass++) {
        const before = out;
        out = out
            .replace(/\(\s*[A-Z]{2,4}\s*\d{0,2}\s*-\s*\d{3,4}\s*\)/gi, ' ')
            .replace(/\[\s*[A-Z]{2,4}\s*\d{0,2}\s*-\s*\d{3,4}\s*\]/gi, ' ')
            .replace(new RegExp(`^\\s*[A-Z]{2,4}\\s*\\d{0,2}\\s*-\\s*\\d{3,4}\\s*[-–—,:]?\\s*`, 'i'), '')
            .replace(new RegExp(`\\s*[-–—,:]?\\s*[A-Z]{2,4}\\s*\\d{0,2}\\s*-\\s*\\d{3,4}\\s*$`, 'i'), '');
        if (out === before) break;
    }
    return out.replace(/\s+/g, ' ').replace(/^[\s\-–—,:]+|[\s\-–—,:]+$/g, '').trim();
};

export const cleanChapterName = (raw?: string | null): string => {
    const t = (raw || '').replace(/\s+/g, ' ').trim();
    if (!t || !CHAPTER_CODE_RE.test(t)) return t;
    // Never blank a chapter: if the cell held nothing but a code we cannot
    // recover the name, so the original value is kept for manual correction.
    return stripChapterCodes(t) || t;
};

export const normalizePhone = (raw?: string | null): string => {
    let digits = (raw || '').replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('234') && digits.length > 10) digits = '0' + digits.slice(3);
    if (digits.length === 11 && digits.startsWith('0')) return digits;
    if (digits.length === 10 && digits.charAt(0) !== '0') return `0${digits}`;
    return digits;
};

// Decodes a `data:` URL into a Blob. Used to avoid `fetch(dataUrl)`, which is
// blocked by the connect-src CSP (data: is only allowed for img/font).
export const dataUrlToBlob = (dataUrl: string): Blob => {
    const comma = dataUrl.indexOf(',');
    const meta = comma >= 0 ? dataUrl.slice(0, comma) : '';
    const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    const mime = /:(.*?);/.exec(meta)?.[1] || 'application/octet-stream';
    if (!/base64/i.test(meta)) return new Blob([decodeURIComponent(payload)], { type: mime });
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
};

export type SharePdfResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Shares a PDF Blob via the native Web Share API, falling back to a download
 * when the platform cannot share PDF files. A user-cancelled share sheet
 * resolves to 'cancelled' (never downloads, never throws).
 */
export const sharePdfBlob = async (
    blob: Blob,
    fileName: string,
    meta?: { title?: string; text?: string }
): Promise<SharePdfResult> => {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
    ) {
        try {
            await navigator.share({ files: [file], title: meta?.title, text: meta?.text });
            return 'shared';
        } catch (e: any) {
            if (e?.name === 'AbortError') return 'cancelled';
        }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return 'downloaded';
};

// Proper CSV line parser: respects double-quoted fields (fields may contain
// commas, e.g. DOB "7th June,1958"). Returns trimmed, unquoted fields.
// Falls back gracefully on malformed input (stray quotes treated literally).
export const parseCsvLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    const s = (line || '') as string;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else cur += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    fields.push(cur.trim());
    return fields;
};

// Splits CSV text into logical records (physical lines), respecting
// double-quoted fields so embedded commas/newlines inside quotes never
// break records — e.g. a header cell like "PHONE/\nWHATSAPP" (literal
// newline inside quotes) stays one record. Mirrors parseCsvLine's quote
// handling so downstream parseCsvLine round-trips cleanly.
export const splitCsvRecords = (text: string): string[] => {
    const records: string[] = [];
    let cur = '';
    let inQuotes = false;
    const s = (text || '') as string;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            cur += ch;
            if (ch === '"') {
                if (s[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            }
        } else if (ch === '"') {
            inQuotes = true;
            cur += ch;
        } else if (ch === '\n') {
            records.push(cur.replace(/\r$/, ''));
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) records.push(cur.replace(/\r$/, ''));
    return records;
};

// Escapes a field for the mapped-CSV output so commas/quotes survive a round-trip.
export const csvEscape = (field: string): string => {
    const s = (field ?? '').trim();
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

// ---------- Full-name parser (Sprint 22/23) ----------
export const KNOWN_TITLES = new Set([
    'mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'pastor', 'rev', 'engr',
    'barr', 'prof', 'sir', 'lady', 'hon', 'elder', 'deacon', 'deaconess',
    'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis', 'prince',
    'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia',
    'arc', 'arch', 'archt', 'comrade', 'evang', 'evng', 'pst', 'eld', 'sen',
    'esq', 'otunba', 'capt', 'maj', 'lt', 'col', 'cmdr', 'adm',
    'amb', 'ambassador', 'master', 'mst', 'mstr', 'esv', 'pharm', 'drs', 'supt'
]);

export type NameOrder = 'given-first' | 'surname-first';

export const canonicalTitle = (rawToken: string): string => {
    const cleaned = (rawToken || '').replace(/^\(|\)$/g, '').trim().toLowerCase().replace(/\.$/, '').trim();
    const shorthand: Record<string, string> = {
        evang: 'Evangelist', evng: 'Evangelist', pst: 'Pastor', eld: 'Elder',
        engr: 'Engr', prof: 'Prof', mrs: 'Mrs', mr: 'Mr', ms: 'Ms', miss: 'Miss',
        dr: 'Dr', chief: 'Chief', pastor: 'Pastor', rev: 'Rev', barr: 'Barr',
        sir: 'Sir', lady: 'Lady', hon: 'Hon', deacon: 'Deacon', deaconess: 'Deaconess',
        bishop: 'Bishop', apostle: 'Apostle', evangelist: 'Evangelist', ven: 'Ven',
        snr: 'Snr', bro: 'Bro', sis: 'Sis', prince: 'Prince', princess: 'Princess',
        oba: 'Oba', alhaji: 'Alhaji', alhaja: 'Alhaja', mallam: 'Mallam', hajia: 'Hajia',
        arc: 'Arch', arch: 'Arch', archt: 'Arch', comrade: 'Comrade', sen: 'Sen',
        esq: 'Esq', otunba: 'Otunba', capt: 'Capt', maj: 'Maj', lt: 'Lt', col: 'Col',
        cmdr: 'Cmdr', adm: 'Adm',
        amb: 'Ambassador', ambassador: 'Ambassador', master: 'Master', mst: 'Master', mstr: 'Master',
        esv: 'Esv', pharm: 'Pharm', drs: 'Drs', supt: 'Supt'
    };
    if (shorthand[cleaned]) return shorthand[cleaned];
    if (!cleaned) return '';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
};

export const normalizeTitleToken = (t: string): string => {
    return (t || '').replace(/^\(|\)$/g, '').trim().toLowerCase().replace(/\.$/, '').trim();
};

// --- Dependant-aware identity family helpers (v1.37d) -------------------------
// `Master`/`Mst`/`Miss` denote a DEPENDANT (son/daughter) who may legitimately
// share a parent's full name, so name matching is gated by an identity family:
//   DEP  dependant markers (master/mst/mstr/miss) — never match adults
//   PRO  professional title present (dr/engr/prof/barr/pastor/rev/evang/esv/...)
//   M    male honorific (mr)      F    female honorific (mrs/ms)
//   P    no title signal
// These mirror the SQL helpers in supabase_migration_reconcile_dependant_family.sql.
const FAMILY_PRO_TITLES = new Set([
    'dr', 'chief', 'pastor', 'rev', 'engr', 'barr', 'prof', 'sir', 'lady', 'hon', 'elder',
    'deacon', 'deaconess', 'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis',
    'prince', 'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia',
    'arc', 'arch', 'archt', 'comrade', 'evang', 'evng', 'pst', 'eld', 'sen', 'esq', 'otunba',
    'capt', 'maj', 'lt', 'col', 'cmdr', 'adm', 'amb', 'ambassador', 'esv', 'pharm', 'drs', 'supt'
]);
const FAMILY_DEP_TITLES = new Set(['master', 'mst', 'mstr', 'miss']);

export const familyOfName = (title?: string, firstName?: string, lastName?: string): string => {
    const tokens: string[] = [
        ...(title || '').toLowerCase().split(/[^a-z0-9]+/),
        ...(firstName || '').toLowerCase().split(/[^a-z0-9]+/),
        ...(lastName || '').toLowerCase().split(/[^a-z0-9]+/)
    ].filter(Boolean);
    if (tokens.some(t => FAMILY_DEP_TITLES.has(t))) return 'DEP';
    if (tokens.some(t => FAMILY_PRO_TITLES.has(t))) return 'PRO';
    if (tokens.includes('mr')) return 'M';
    if (tokens.includes('mrs') || tokens.includes('ms')) return 'F';
    return 'P';
};

export const canonicalNameKeyStr = (firstName?: string, lastName?: string): string => {
    const tokens = [...(firstName || '').toLowerCase().split(/[^a-z0-9]+/),
                    ...(lastName || '').toLowerCase().split(/[^a-z0-9]+/)]
        .filter(Boolean)
        .filter(t => !KNOWN_TITLES.has(t));
    return [...new Set(tokens)].sort().join(' ');
};

export const familyAwareNameKey = (title?: string, firstName?: string, lastName?: string): string =>
    `${familyOfName(title, firstName, lastName)}|${canonicalNameKeyStr(firstName, lastName)}`;

export const tokenizeFullName = (fullName: string): string[] => {
    const cleaned = (fullName || '').trim()
        .replace(/^[\s.:,;]+/, '')
        .replace(/\s+/g, ' ');
    if (!cleaned) return [];
    const tokens: string[] = [];
    for (const word of cleaned.split(' ')) {
        if (!word) continue;
        const segments = word.split(/[.,;:]/);
        for (let seg of segments) {
            seg = (seg || '').trim();
            if (!seg) continue;
            if (seg.length === 1) {
                const prev = tokens.pop();
                tokens.push((prev ? prev + ' ' : '') + seg);
            } else {
                tokens.push(seg);
            }
        }
    }
    return tokens.filter(t => t && t.trim());
};

export function parseFullName(fullName: string, order: NameOrder = 'given-first'): { title: string; firstName: string; lastName: string } {
    const empty = { title: '', firstName: '', lastName: '' };
    if (!fullName || !fullName.trim()) return empty;
    const tokens = tokenizeFullName(fullName);
    if (tokens.length === 0) return empty;

    const titleRuns: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < tokens.length) {
        if (KNOWN_TITLES.has(normalizeTitleToken(tokens[i]))) {
            const start = i;
            while (i < tokens.length && KNOWN_TITLES.has(normalizeTitleToken(tokens[i]))) i++;
            titleRuns.push({ start, end: i });
        } else {
            i++;
        }
    }

    if (titleRuns.length >= 2) {
        const firstRun = titleRuns[0];
        const lastRun = titleRuns[titleRuns.length - 1];
        const title = canonicalTitle(tokens[firstRun.start]);
        const surname = tokens.slice(firstRun.end, lastRun.start).join(' ') || tokens[0];
        const given = tokens.slice(lastRun.end).join(' ');
        return { title, firstName: given, lastName: surname };
    }

    if (titleRuns.length === 1) {
        const run = titleRuns[0];
        const title = canonicalTitle(tokens[run.start]);
        const before = tokens.slice(0, run.start);
        const after = tokens.slice(run.end);
        if (run.start === 0) {
            const firstName = after[0] || '';
            const lastName = after.slice(1).join(' ');
            return { title, firstName, lastName };
        }
        if (order === 'surname-first') {
            const surname = before.join(' ');
            const given = after.join(' ');
            return { title, firstName: given, lastName: surname };
        }
        const firstName = before[0] || '';
        const lastName = before.slice(1).concat(after).join(' ');
        return { title, firstName, lastName: lastName || firstName };
    }

    if (order === 'surname-first') {
        const surname = tokens[0];
        const given = tokens.slice(1).join(' ');
        return { title: '', firstName: given, lastName: surname };
    }
    const firstName = tokens[0];
    const lastName = tokens.slice(1).join(' ');
    return { title: '', firstName, lastName: lastName || firstName };
}

export const downloadJSON = (data: any, filename: string) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Registration date-range helpers. `delegates.created_at` is UTC, but officers
// pick local calendar days — convert to inclusive local-day bounds so the first
// and last hour of the selected window are never lost.
export interface DateRangeFilter {
    from?: string;
    to?: string;
}

export const hasDateRange = (range?: DateRangeFilter | null): boolean =>
    !!(range && (range.from || range.to));

export const localDayStartISO = (day?: string): string | undefined => {
    if (!day) return undefined;
    const d = new Date(`${day}T00:00:00.000`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export const localDayEndISO = (day?: string): string | undefined => {
    if (!day) return undefined;
    const d = new Date(`${day}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export const toServerDateRange = (range?: DateRangeFilter | null): { from?: string; to?: string } => ({
    from: localDayStartISO(range?.from),
    to: localDayEndISO(range?.to),
});

const dayLabel = (day?: string): string => {
    if (!day) return '';
    const d = new Date(`${day}T00:00:00.000`);
    if (Number.isNaN(d.getTime())) return day;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const describeDateRange = (range?: DateRangeFilter | null): string => {
    if (!hasDateRange(range)) return '';
    if (range?.from && range?.to) return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
    if (range?.from) return `from ${dayLabel(range.from)}`;
    return `up to ${dayLabel(range?.to)}`;
};

export const exportToCSV = (rows: Record<string, any>[], filename: string, columns?: string[]) => {
    const cols = columns || Object.keys(rows[0] || {});
    const header = cols.join(',');
    const body = rows.map(row => 
        cols.map(c => {
            const val = String(row[c] ?? '');
            return val.includes(',') || val.includes('"') || val.includes('\n')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
        }).join(',')
    );
    const csv = [header, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * District-first ordering for the Master List exports (CSV + PDF).
 * Districts sort naturally (North Central 1 < North Central 2), blank
 * districts are pushed last, then surname and first name break ties.
 */
export const sortDelegatesByDistrict = <T extends {
    district?: string | null;
    last_name?: string | null;
    first_name?: string | null;
}>(rows: T[]): T[] => {
    const norm = (v?: string | null) => (v || '').replace(/\s+/g, ' ').trim();
    return [...rows].sort((a, b) => {
        const da = norm(a.district);
        const dbDist = norm(b.district);
        // Blank districts last.
        if (!da !== !dbDist) return da ? -1 : 1;
        const byDistrict = da.localeCompare(dbDist, undefined, { sensitivity: 'base', numeric: true });
        if (byDistrict !== 0) return byDistrict;
        const byLast = norm(a.last_name).localeCompare(norm(b.last_name), undefined, { sensitivity: 'base' });
        if (byLast !== 0) return byLast;
        return norm(a.first_name).localeCompare(norm(b.first_name), undefined, { sensitivity: 'base' });
    });
};

/**
 * Dual-mode PDF Export:
 *
 * REPORT mode (default) — for data tables, matrices, financial grids.
 *   Uses aggressive CSS sanitization (overflow flatten, min-w-max reset,
 *   Tailwind color fallbacks) and a fixed wide viewport. Applies the
 *   `pdf-export-mode` class to trigger table-reset rules.
 *
 * DOCUMENT mode — for prose documents (User Manual, Training Guide).
 *   Lightweight capture: preserves natural padding/max-width. No table
 *   flattening, no Tailwind color injection. Uses the built-in A4
 *   viewport (portrait: ~756px, landscape: ~1085px).
 */
export const exportToPDF = (
    element: HTMLElement,
    filename: string,
    orientation: 'portrait' | 'landscape',
    forceViewportWidth?: number,
    documentType?: 'report' | 'document'
) => {
    if (!element) {
        console.error("PDF export failed: Invalid element.");
        return;
    }

    const isReport = documentType !== 'document';

    const defaultWidth = orientation === 'landscape'
        ? Math.round(287 * 96 / 25.4)
        : Math.round(200 * 96 / 25.4);
    const viewportWidth = forceViewportWidth ?? defaultWidth;
    window.scrollTo(0, 0);

    if (isReport && !document.getElementById('pdf-export-print-styles')) {
        const style = document.createElement('style');
        style.id = 'pdf-export-print-styles';
        style.textContent = `
            .pdf-export-mode .overflow-x-auto,
            .pdf-export-mode .overflow-hidden { overflow: visible !important; }
            .pdf-export-mode .min-w-max { min-width: 0 !important; width: 100% !important; }
            .pdf-export-mode .sticky { position: static !important; }
            .pdf-export-mode .print-only { display: flex !important; }
            .pdf-export-mode .no-print { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    const nodeToPrint = element.cloneNode(true) as HTMLElement;
    nodeToPrint.classList.remove('rounded-[2.5rem]', 'min-h-screen');
    nodeToPrint.style.borderRadius = '0';
    nodeToPrint.style.minHeight = '0';
    nodeToPrint.classList.add('print-mode');

    if (isReport) {
        nodeToPrint.classList.add('pdf-export-mode');
    }

    const printContainer = document.createElement('div');
    printContainer.id = 'pdf-export-container';
    printContainer.style.position = 'fixed';
    printContainer.style.left = '-20000px';
    printContainer.style.top = '0';
    if (isReport) {
        printContainer.style.width = `${viewportWidth}px`;
    }
    printContainer.style.background = '#ffffff';
    printContainer.style.zIndex = '-9999';
    printContainer.style.overflow = 'visible';

    printContainer.appendChild(nodeToPrint);
    document.body.appendChild(printContainer);

    let captureWidth = viewportWidth;
    if (isReport) {
        // Measure the widest laid-out table so the raster capture can never crop
        // the right-most columns. scrollWidth alone under-reports when the table
        // is width:100% inside a fixed-width container but overflows it, so take
        // the max of every width signal (only ever widens the capture).
        const widest = Array.from(nodeToPrint.querySelectorAll('table')).reduce((m, t) => {
            const rect = t.getBoundingClientRect();
            return Math.max(m, t.scrollWidth || 0, t.offsetWidth || 0, Math.ceil(rect.width) || 0);
        }, 0);
        captureWidth = Math.max(viewportWidth, Math.min(widest, 2600));
        printContainer.style.width = `${captureWidth}px`;
    }

    const reportOnclone = (clonedDoc: Document) => {
        clonedDoc.querySelectorAll('.overflow-x-auto, .overflow-hidden').forEach(el => {
            (el as HTMLElement).style.overflow = 'visible';
        });
        clonedDoc.querySelectorAll('.min-w-max').forEach(el => {
            (el as HTMLElement).style.minWidth = '0';
            (el as HTMLElement).style.width = '100%';
        });
        clonedDoc.querySelectorAll('.sticky').forEach(el => {
            (el as HTMLElement).style.position = 'static';
        });
        const root = clonedDoc.querySelector('.print-mode') as HTMLElement;
        if (root) {
            root.style.setProperty('border-radius', '0', 'important');
            root.style.setProperty('min-height', '0', 'important');
        }
        clonedDoc.querySelectorAll('.bg-blue-900').forEach(el => {
            (el as HTMLElement).style.setProperty('background-color', '#1e3a8a', 'important');
            (el as HTMLElement).style.setProperty('color', '#ffffff', 'important');
        });
        clonedDoc.querySelectorAll('.bg-slate-800').forEach(el => {
            (el as HTMLElement).style.setProperty('background-color', '#1e293b', 'important');
            (el as HTMLElement).style.setProperty('color', '#ffffff', 'important');
        });
        clonedDoc.querySelectorAll('.report-section-header').forEach(el => {
            (el as HTMLElement).style.setProperty('background-color', '#1e3a8a', 'important');
            (el as HTMLElement).style.setProperty('color', '#ffffff', 'important');
            (el as HTMLElement).style.setProperty('display', 'block', 'important');
        });
        clonedDoc.querySelectorAll('.print-gold').forEach(el => {
            (el as HTMLElement).style.setProperty('background-color', '#fbbf24', 'important');
            (el as HTMLElement).style.setProperty('color', '#1e3a8a', 'important');
        });
    };

    const documentOnclone = (clonedDoc: Document) => {
        const root = clonedDoc.querySelector('.print-mode') as HTMLElement;
        if (root) {
            root.style.setProperty('border-radius', '0', 'important');
            root.style.setProperty('min-height', '0', 'important');
        }
    };

    const html2canvasConfig: any = {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
    };

    if (isReport) {
        html2canvasConfig.width = captureWidth;
        html2canvasConfig.windowWidth = captureWidth;
        html2canvasConfig.onclone = reportOnclone;
    } else {
        html2canvasConfig.onclone = documentOnclone;
    }

    const options: {
        margin: number[];
        filename: string;
        image: { type: string; quality: number };
        html2canvas: any;
        jsPDF: { unit: string; format: string; orientation: 'portrait' | 'landscape'; compress: boolean };
        pagebreak?: { mode: ('css' | 'legacy' | 'avoid-all')[]; avoid?: string | string[] };
    } = {
        margin: [5, 5, 5, 5],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: html2canvasConfig,
        jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: orientation,
            compress: true
        }
    };

    // Document mode: disable html2pdf's css-mode pagebreak (it inserts
    // near-full-page white spacer divs before any `break-inside: avoid` element
    // that straddles a page boundary — with tall manual sections this created
    // giant blank bands). Instead rely on explicit `avoid` selectors so bounded
    // cards (rounded boxes) are pushed wholesale onto the next page instead of
    // being sliced mid-card at the fixed page boundary.
    // Reports keep css mode (relies on `tr { page-break-inside: avoid }`).
    if (!isReport) {
        options.pagebreak = { mode: [], avoid: '.rounded-xl, .rounded-2xl, .rounded-3xl' };
    }

    requestAnimationFrame(() => {
        setTimeout(() => {
            // @ts-ignore
            window.html2pdf().from(nodeToPrint).set(options).save().then(() => {
                if (printContainer.parentNode) document.body.removeChild(printContainer);
            }).catch((error: any) => {
                console.error("PDF error:", error);
                if (printContainer.parentNode) document.body.removeChild(printContainer);
            });
        }, 500);
    });
};

/* ------------------------------------------------------------------------- *
 * Master List PDF — vector (jsPDF text) exporter
 *
 * The html2canvas path (exportToPDF) renders the WHOLE table into one canvas
 * at scale 2, which blows past the browser canvas limits at roughly 480 rows
 * (canvas height cap ~32,767 px, lower on Android). Any full-dataset Master
 * List export therefore died silently mid-render. This exporter draws text
 * page by page instead: no canvas, no dimension ceiling, searchable output,
 * and identical behaviour on desktop and mobile.
 *
 * jsPDF's built-in Helvetica only covers WinAnsi, so display text is folded
 * to ASCII (accents stripped, ẹ/ọ/ṣ and ₦ mapped). CSV keeps the exact bytes.
 * ------------------------------------------------------------------------- */
export interface MasterListPdfColumn {
    label: string;
    weight: number;
    align?: 'left' | 'center' | 'right';
}

export interface MasterListPdfRow {
    values: string[];
    district?: string;
}

export interface MasterListPdfOptions {
    filename: string;
    title?: string;
    subtitleLines?: string[];
    columns: MasterListPdfColumn[];
    rows: MasterListPdfRow[];
    groupByDistrict?: boolean;
    /** Draws the per-district totals block under the report header on page 1. */
    districtTotals?: boolean;
    onProgress?: (done: number, total: number) => void;
}

const PDF_CHAR_MAP: Record<string, string> = {
    'ẹ': 'e', 'Ẹ': 'E', 'ọ': 'o', 'Ọ': 'O', 'ṣ': 's', 'Ṣ': 'S', 'ń': 'n', 'Ń': 'N',
    '₦': 'N', '–': '-', '—': '-', '−': '-', '…': '...',
    '‘': "'", '’': "'", '“': '"', '”': '"', '·': '-'
};

const pdfSafeText = (raw: unknown): string => {
    const mapped = String(raw ?? '').replace(/[ẹẸọỌṣṢńŃ₦–—−…‘’“”·]/g, ch => PDF_CHAR_MAP[ch] ?? ch);
    return mapped.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
};

export const exportMasterListPDF = async (opts: MasterListPdfOptions): Promise<{ pages: number; rows: number }> => {
    const JsPdfCtor = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
    if (!JsPdfCtor) {
        throw new Error('PDF library (jsPDF) is not loaded. Reload the page and try again.');
    }
    const cols = opts.columns.filter(c => c.weight > 0);
    if (cols.length === 0) throw new Error('No columns are available for PDF export.');

    const pdf = new JsPdfCtor({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const pageW: number = pdf.internal.pageSize.getWidth();
    const pageH: number = pdf.internal.pageSize.getHeight();
    const marginX = 6;
    const marginTop = 6;
    const marginBottom = 10;
    const usableW = pageW - marginX * 2;
    const pageBottom = pageH - marginBottom;
    const ROW_H = 4.6;
    const HEADER_H = 6.4;
    const BAND_H = 5.6;
    const title = pdfSafeText(opts.title || 'FGBMFI NIGERIA - DELEGATE MASTER LIST');
    const subtitleLines = (opts.subtitleLines || []).map(pdfSafeText);

    const totalWeight = cols.reduce((sum, c) => sum + c.weight, 0);
    const widths = cols.map(c => (c.weight / totalWeight) * usableW);

    // Ellipsize with the CURRENT font/size applied.
    const fit = (text: string, maxW: number): string => {
        if (!text) return '';
        if (pdf.getTextWidth(text) <= maxW) return text;
        let cut = text;
        while (cut.length > 1 && pdf.getTextWidth(cut + '...') > maxW) cut = cut.slice(0, -1);
        return cut + '...';
    };

    const drawPageChrome = (): number => {
        let y = marginTop;
        pdf.setTextColor(30, 58, 138);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text(title, marginX, y + 4.2);
        y += 5.6;
        pdf.setDrawColor(200, 200, 200);
        pdf.line(marginX, y, marginX + usableW, y);
        y += 3.4;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(70, 70, 70);
        for (const line of subtitleLines.slice(0, 3)) {
            pdf.text(fit(line, usableW), marginX, y + 2.4);
            y += 3.4;
        }
        pdf.setTextColor(0, 0, 0);
        return y + 1.2;
    };

    const drawColumnHeader = (yTop: number): number => {
        pdf.setFillColor(30, 58, 138);
        pdf.rect(marginX, yTop, usableW, HEADER_H, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.8);
        let x = marginX;
        cols.forEach((col, i) => {
            const w = widths[i];
            // Long labels wrap to two lines inside the header band instead of
            // being truncated ("Last activity", "Registered", ...).
            const labelLines = (pdf.splitTextToSize(pdfSafeText(col.label).toUpperCase(), w - 2) as string[])
                .slice(0, 2)
                .map(line => fit(line, w - 2));
            const singleLine = labelLines.length <= 1;
            labelLines.forEach((line, li) => {
                const baseline = singleLine ? yTop + HEADER_H - 2 : yTop + 2.7 + li * 2.6;
                if (col.align === 'right') pdf.text(line, x + w - 1, baseline, { align: 'right' });
                else if (col.align === 'center') pdf.text(line, x + w / 2, baseline, { align: 'center' });
                else pdf.text(line, x + 1, baseline);
            });
            x += w;
        });
        pdf.setTextColor(0, 0, 0);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
        return yTop + HEADER_H;
    };

    const drawDistrictBand = (label: string, count: number, yTop: number, continued = false) => {
        pdf.setFillColor(30, 58, 138);
        pdf.rect(marginX, yTop, usableW, BAND_H, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.4);
        const suffix = `${count} DELEGATE${count === 1 ? '' : 'S'}`;
        const bandName = label
            ? `${pdfSafeText(label).toUpperCase()} DISTRICT`
            : 'NO DISTRICT';
        const bandLabel = `${bandName}${continued ? ' (CONTINUED)' : ''} - ${suffix}`;
        pdf.text(fit(bandLabel, usableW - 4), marginX + 2, yTop + 3.9);
        pdf.setTextColor(0, 0, 0);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
    };

    // Per-district totals in the report header: the same numbers the bands carry,
    // stated once up front so a printed report can be read without paging through.
    const drawDistrictTotals = (yTop: number): number => {
        if (districtCounts.size === 0) return yTop;
        const pairs = Array.from(districtCounts.entries()).map(([label, count]) => ({
            label: pdfSafeText(label || 'NO DISTRICT').toUpperCase(),
            count,
        }));
        const totalCount = pairs.reduce((sum, p) => sum + p.count, 0);
        const cols = Math.min(4, Math.max(1, Math.ceil(pairs.length / 12)));
        const rowsNeeded = Math.ceil(pairs.length / cols);
        const rowH = 3.2;
        const headH = 5;
        const blockH = headH + rowsNeeded * rowH + 2.4;

        pdf.setFillColor(246, 247, 249);
        pdf.setDrawColor(208, 213, 221);
        pdf.rect(marginX, yTop, usableW, blockH, 'FD');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.2);
        pdf.setTextColor(30, 58, 138);
        pdf.text('DISTRICT TOTALS', marginX + 2, yTop + 3.4);
        pdf.text(
            `${totalCount.toLocaleString('en-GB')} DELEGATE${totalCount === 1 ? '' : 'S'}`,
            marginX + usableW - 2,
            yTop + 3.4,
            { align: 'right' }
        );

        pdf.setTextColor(40, 40, 40);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.4);
        const colW = (usableW - 4) / cols;
        pairs.forEach((pair, i) => {
            const col = Math.floor(i / rowsNeeded);
            const rowIdx = i % rowsNeeded;
            const x = marginX + 2 + col * colW;
            const baseline = yTop + headH + rowIdx * rowH + 2.2;
            pdf.text(fit(pair.label, colW - 12), x, baseline);
            pdf.text(String(pair.count), x + colW - 3, baseline, { align: 'right' });
        });

        pdf.setTextColor(0, 0, 0);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
        return yTop + blockH + 2.4;
    };

    const drawRow = (values: string[], yTop: number, zebra: boolean) => {
        if (zebra) {
            pdf.setFillColor(245, 246, 248);
            pdf.rect(marginX, yTop, usableW, ROW_H, 'F');
        }
        let x = marginX;
        cols.forEach((col, i) => {
            const w = widths[i];
            const raw = pdfSafeText(values[i]);
            if (raw) {
                const cell = fit(raw, w - 2);
                const baseline = yTop + ROW_H - 1.5;
                if (col.align === 'right') pdf.text(cell, x + w - 1, baseline, { align: 'right' });
                else if (col.align === 'center') pdf.text(cell, x + w / 2, baseline, { align: 'center' });
                else pdf.text(cell, x + 1, baseline);
            }
            x += w;
        });
        pdf.setDrawColor(226, 228, 232);
        pdf.line(marginX, yTop + ROW_H, marginX + usableW, yTop + ROW_H);
    };

    const districtCounts = new Map<string, number>();
    if (opts.groupByDistrict) {
        opts.rows.forEach(r => {
            const key = r.district || '';
            districtCounts.set(key, (districtCounts.get(key) || 0) + 1);
        });
    }

    let y = drawPageChrome();
    if (opts.groupByDistrict && opts.districtTotals !== false) {
        y = drawDistrictTotals(y);
    }
    y = drawColumnHeader(y);
    let zebra = false;
    let lastDistrict: string | null = null;

    for (let i = 0; i < opts.rows.length; i++) {
        const row = opts.rows[i];
        const districtKey = opts.groupByDistrict ? (row.district || '') : null;
        const needsBand = districtKey !== null && districtKey !== lastDistrict;

        if (y + ROW_H + (needsBand ? BAND_H : 0) > pageBottom) {
            pdf.addPage();
            y = drawPageChrome();
            y = drawColumnHeader(y);
            zebra = false;
            // A district that continues onto a new page keeps its context.
            if (districtKey !== null && !needsBand) {
                drawDistrictBand(districtKey, districtCounts.get(districtKey) || 0, y, true);
                y += BAND_H;
            }
        }
        if (needsBand && districtKey !== null) {
            drawDistrictBand(districtKey, districtCounts.get(districtKey) || 0, y);
            y += BAND_H;
            lastDistrict = districtKey;
        }
        drawRow(row.values, y, zebra);
        y += ROW_H;
        zebra = !zebra;

        if (opts.onProgress && (i + 1) % 200 === 0) {
            opts.onProgress(i + 1, opts.rows.length);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }
    opts.onProgress?.(opts.rows.length, opts.rows.length);

    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setDrawColor(200, 200, 200);
        pdf.line(marginX, pageH - 7, marginX + usableW, pageH - 7);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
        pdf.setTextColor(110, 110, 110);
        pdf.text('FGBMFI Nigeria EMS - Delegate Master List', marginX, pageH - 4);
        pdf.text(`Page ${p} of ${pages}`, marginX + usableW, pageH - 4, { align: 'right' });
    }
    pdf.setTextColor(0, 0, 0);

    pdf.save(opts.filename);
    return { pages, rows: opts.rows.length };
};

/* ------------------------------------------------------------------------- *
 * Master List CSV — district-grouped report layout
 *
 * The PDF groups rows under district bands, so the CSV mirrors that structure:
 * a report header block, a DISTRICT TOTALS table, then one sub-header row per
 * district followed by its delegates. Panel rows carry no name data, so the
 * import junk guard skips them if a file is ever fed back through Bulk Import.
 * ------------------------------------------------------------------------- */
export interface MasterListCsvRow {
    values: string[];
    district?: string;
}

export interface MasterListCsvOptions {
    filename: string;
    headerLines?: string[];
    columns: string[];
    rows: MasterListCsvRow[];
    groupByDistrict?: boolean;
    /** UTF-8 BOM (default on) so Excel renders Nigerian diacritics correctly. */
    bom?: boolean;
}

export const exportMasterListCSV = (opts: MasterListCsvOptions): { rows: number; districts: number } => {
    const group = opts.groupByDistrict !== false;
    const districtCounts = new Map<string, number>();
    if (group) {
        opts.rows.forEach(r => {
            const key = (r.district || '').trim();
            districtCounts.set(key, (districtCounts.get(key) || 0) + 1);
        });
    }

    const cells = (values: (string | number)[]): string => values.map(v => csvEscape(String(v ?? ''))).join(',');
    const blankTail = (from: number): string[] => opts.columns.slice(from).map(() => '');
    const out: string[] = [];

    for (const line of opts.headerLines || []) out.push(csvEscape(line));
    out.push('');

    if (group && districtCounts.size > 0) {
        out.push(csvEscape('DISTRICT TOTALS'));
        out.push(cells(['District', 'Delegates']));
        for (const [label, count] of districtCounts) {
            out.push(cells([label || 'NO DISTRICT', count]));
        }
        out.push(cells(['TOTAL', opts.rows.length]));
        out.push('');
    }

    out.push(cells(opts.columns));

    let lastDistrict: string | null = null;
    for (const row of opts.rows) {
        const key = group ? (row.district || '').trim() : null;
        if (key !== null && key !== lastDistrict) {
            out.push(cells([
                key ? `${key.toUpperCase()} DISTRICT` : 'NO DISTRICT',
                String(districtCounts.get(key) || 0),
                ...blankTail(2),
            ]));
            lastDistrict = key;
        }
        out.push(cells(row.values));
    }

    if (group) {
        out.push(cells(['TOTAL', opts.rows.length, ...blankTail(2)]));
    }

    const csv = (opts.bom === false ? '' : '\uFEFF') + out.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', opts.filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return { rows: opts.rows.length, districts: districtCounts.size };
};

// Shared QR payload parser (online scan path + offline roster resolver).
// JSON payloads (portal / 3rd-party badges) may use arbitrary key spellings, so
// canonical snake_case aliases are added WITHOUT clobbering explicit keys.
const QR_KEY_ALIASES: Record<string, string[]> = {
    reg_id: ['regid', 'reg_id', 'registrationid', 'registration_id', 'portalregid', 'portal_reg_id', 'portal_id'],
    delegate_id: ['delegateid', 'delegate_id'],
    external_id: ['externalid', 'external_id'],
    first_name: ['firstname', 'first_name', 'givenname', 'given_name'],
    last_name: ['lastname', 'last_name', 'surname', 'familyname', 'family_name'],
    title: ['title'],
    phone: ['phone', 'phonenumber', 'phone_number', 'mobile', 'mobilenumber', 'mobile_number', 'whatsapp', 'whatsappnumber', 'whatsapp_number', 'tel', 'telephone'],
    email: ['email', 'emailaddress', 'email_address'],
    district: ['district'],
    chapter: ['chapter'],
    delegate_type: ['delegatetype', 'delegate_type', 'type'],
    rank: ['rank'],
    office: ['office'],
};

const qrKeyNorm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const canonicalQrKey = (k: string): string | null => {
    const norm = qrKeyNorm(k);
    for (const [canonical, aliases] of Object.entries(QR_KEY_ALIASES)) {
        if (aliases.some(a => qrKeyNorm(a) === norm)) return canonical;
    }
    return null;
};

export const parseQrPayload = (raw: string): Record<string, string> | null => {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const result: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === 'string') result[k] = v;
            }
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v !== 'string' || !v.trim()) continue;
                const canonical = canonicalQrKey(k);
                if (canonical && !result[canonical]) result[canonical] = v;
            }
            return Object.keys(result).length > 0 ? result : null;
        }
    } catch {}

    const extractFromFields = (fields: string[]): Record<string, string> | null => {
        const result: Record<string, string> = {};

        const idField = fields.find(f => f.length >= 20 && /[A-Z0-9]{20,}/i.test(f));
        if (idField) {
            const m = idField.match(/[A-Z0-9]{20,}/i);
            if (m) result['delegate_id'] = m[0];
        }

        const nameField = fields.find(f => {
            const clean = f.replace(/^null\s*/i, '').trim();
            return clean.includes(' ') && !/^[A-Z0-9_]+$/.test(clean);
        });
        if (nameField) {
            let clean = nameField.replace(/^null\s*null\s*/i, '').replace(/^null\s*/i, '').trim();
            const parts = clean.split(/\s+/);
            if (parts[0].endsWith('.')) result['title'] = parts.shift()!;
            if (parts.length >= 2) {
                result['first_name'] = parts.slice(0, -1).join(' ');
                result['last_name'] = parts[parts.length - 1];
            } else if (parts.length === 1) {
                result['first_name'] = parts[0];
            }
        }

        const nonIdNameTypeFields = fields.filter(f => f !== idField && f !== nameField && !/^[A-Z][A-Z_]{3,}$/.test(f));
        if (nonIdNameTypeFields.length >= 1) result['district'] = nonIdNameTypeFields[0];
        if (nonIdNameTypeFields.length >= 2) result['chapter'] = nonIdNameTypeFields[1];

        const typeField = fields.find(f => /^[A-Z][A-Z_]{3,}$/.test(f));
        if (typeField) result['delegate_type'] = typeField;

        if (result['delegate_id'] && result['first_name'] && result['last_name']) return result;
        return null;
    };

    const csvFields = raw.split(/[,|]/).map(f => f.trim()).filter(f => f.length > 0 && !/^null$/i.test(f));
    if (csvFields.length >= 3) {
        const parsed = extractFromFields(csvFields);
        if (parsed) return parsed;
    }

    const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length >= 1) {
        const parsed = extractFromFields(lines);
        if (parsed) return parsed;
    }

    return null;
};