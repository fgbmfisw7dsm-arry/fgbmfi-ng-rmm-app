export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN'
    }).format(amount);
};

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

export const districtAliasKey = (v?: string | null): string =>
    (v || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/[^A-Z0-9]/g, '');

// Explicit district aliases: labels used in source CSVs that must resolve to
// an official FGBMFI district. Extend here as new state/zone labels appear.
export const DISTRICT_ALIASES: Record<string, string> = {
    'ANAMBRA': 'South East 1',
};

// Resolves a district value to its official name. Handles the region short
// codes (NC1, SW 2, ...) INCLUDING the 'D' variant used in some manual-reg
// files (SED 1 -> South East 1), plus explicit aliases (Anambra -> South East 1).
export const resolveDistrictAlias = (raw?: string | null): string | null => {
    const key = districtAliasKey(raw || '');
    if (!key) return null;
    const match = key.match(/^(NC|NE|NW|SE|SS|SW)D?(\d+)$/);
    if (match) return `${REGION_PREFIXES[match[1]]} ${match[2].replace(/^0+/, '')}`;
    return DISTRICT_ALIASES[key] || null;
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
    const cleaned = v.toUpperCase().replace(/\s+/g, ' ').trim().replace(/[^A-Z0-9]/g, '');
    const match = cleaned.match(/^(NC|NE|NW|SE|SS|SW)D?(\d+)$/);
    if (match) return `${REGION_PREFIXES[match[1]]} ${match[2].replace(/^0+/, '')}`;
    const alias = DISTRICT_ALIASES[districtAliasKey(trimmed)];
    if (alias) return alias;
    return trimmed;
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

// ---------- Full-name parser (Sprint 22/23) ----------
export const KNOWN_TITLES = new Set([
    'mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'pastor', 'rev', 'engr',
    'barr', 'prof', 'sir', 'lady', 'hon', 'elder', 'deacon', 'deaconess',
    'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis', 'prince',
    'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia',
    'arc', 'arch', 'archt', 'comrade', 'evang', 'evng', 'pst', 'eld', 'sen',
    'esq', 'otunba', 'capt', 'maj', 'lt', 'col', 'cmdr', 'adm'
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
        cmdr: 'Cmdr', adm: 'Adm'
    };
    if (shorthand[cleaned]) return shorthand[cleaned];
    if (!cleaned) return '';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
};

export const normalizeTitleToken = (t: string): string => {
    return (t || '').replace(/^\(|\)$/g, '').trim().toLowerCase().replace(/\.$/, '').trim();
};

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
        html2canvasConfig.width = viewportWidth;
        html2canvasConfig.windowWidth = viewportWidth;
        html2canvasConfig.onclone = reportOnclone;
    } else {
        html2canvasConfig.onclone = documentOnclone;
    }

    const options = {
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