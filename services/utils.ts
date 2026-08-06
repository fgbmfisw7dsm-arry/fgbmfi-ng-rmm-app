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

/**
 * Generates a deterministic 4-digit code from a Delegate ID and Event ID.
 * This is a backward-compatible offline fallback for environments
 * where QR scanning is not available. 10K code slots — not suitable
 * as primary identifier above 10K delegates.
 */
export const generateCodeFromId = (delegateId: string, eventId: string): string => {
    if (!delegateId || !eventId) return "0000";
    const salt = delegateId + eventId;
    let hash = 0;
    for (let i = 0; i < salt.length; i++) {
        const char = salt.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const code = (Math.abs(hash) % 9999) + 1;
    return code.toString().padStart(4, '0');
};

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