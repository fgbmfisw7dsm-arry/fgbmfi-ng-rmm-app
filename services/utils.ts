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
 * Enhanced PDF Export: Uses a wider viewport (1600px) for landscape and exact A4
 * inner width (756px) for portrait to prevent html2canvas offset cropping (left-side
 * clipping). The onclone callback strips border-radius (primary cause of html2canvas
 * capture offset artifacts on rounded containers), overrides min-height to prevent
 * viewport-height issues in the cloned iframe, removes break-inside-avoid (image-based
 * pagination ignores CSS page-break rules), restores padding on manual/document
 * containers stripped by .print-mode CSS, and applies explicit background/color
 * fallbacks for Tailwind utility classes that html2canvas may fail to resolve.
 */
export const exportToPDF = (element: HTMLElement, filename: string, orientation: 'portrait' | 'landscape') => {
    if (!element) {
        console.error("PDF export failed: Invalid element.");
        return;
    }

    const viewportWidth = orientation === 'landscape' ? 1600 : Math.round(200 * 96 / 25.4);
    window.scrollTo(0, 0);

    if (!document.getElementById('pdf-export-print-styles')) {
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
    nodeToPrint.classList.add('print-mode');
    nodeToPrint.classList.add('pdf-export-mode');
    
    const printContainer = document.createElement('div');
    printContainer.id = 'pdf-export-container';
    printContainer.style.position = 'fixed';
    printContainer.style.left = '-20000px';
    printContainer.style.top = '0';
    printContainer.style.width = `${viewportWidth}px`;
    printContainer.style.background = '#ffffff';
    printContainer.style.zIndex = '-9999';
    printContainer.style.overflow = 'visible';
    
    printContainer.appendChild(nodeToPrint);
    document.body.appendChild(printContainer);

    const options = {
        margin: [5, 5, 5, 5],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2,
            useCORS: true, 
            logging: false,
            backgroundColor: '#ffffff',
            width: viewportWidth,
            windowWidth: viewportWidth,
            onclone: (clonedDoc: Document) => {
                const cssStyle = clonedDoc.createElement('style');
                cssStyle.textContent = `
                    .print-mode, .pdf-export-mode { border-radius: 0 !important; min-height: 0 !important; }
                    .print-mode .overflow-x-auto,
                    .print-mode .overflow-hidden,
                    .pdf-export-mode .overflow-x-auto,
                    .pdf-export-mode .overflow-hidden { overflow: visible !important; }
                    .print-mode .min-w-max,
                    .pdf-export-mode .min-w-max { min-width: 0 !important; width: 100% !important; }
                    .print-mode .sticky,
                    .pdf-export-mode .sticky { position: static !important; }
                `;
                clonedDoc.head.appendChild(cssStyle);

                const root = clonedDoc.querySelector('.print-mode') as HTMLElement;
                if (root) {
                    root.style.borderRadius = '0';
                    root.style.minHeight = '0';
                    if (root.classList.contains('p-12') || root.classList.contains('md:p-16')) {
                        root.style.padding = '48px';
                    }
                }

                clonedDoc.querySelectorAll('.break-inside-avoid').forEach(el => {
                    (el as HTMLElement).style.breakInside = 'auto';
                });

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
            }
        },
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