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
 * Enhanced PDF Export: Uses a wider viewport (1600px) and proper scaling 
 * to ensure wide Matrix tables are not truncated during export.
 */
export const exportToPDF = (element: HTMLElement, filename: string, orientation: 'portrait' | 'landscape') => {
    if (!element) {
        console.error("PDF export failed: Invalid element.");
        return;
    }

    // Increased width for capturing full Matrix width
    const viewportWidth = orientation === 'landscape' ? 1600 : 900;
    window.scrollTo(0, 0);

    const nodeToPrint = element.cloneNode(true) as HTMLElement;
    nodeToPrint.classList.add('print-mode');
    
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
            scale: 2, // Higher scale for clarity
            useCORS: true, 
            logging: false,
            backgroundColor: '#ffffff',
            width: viewportWidth,
            windowWidth: viewportWidth
        },
        jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: orientation, 
            compress: true 
        }
    };

    setTimeout(() => {
        // @ts-ignore
        window.html2pdf().from(nodeToPrint).set(options).save().then(() => {
            if (printContainer.parentNode) document.body.removeChild(printContainer);
        }).catch((error: any) => {
            console.error("PDF error:", error);
            if (printContainer.parentNode) document.body.removeChild(printContainer);
        });
    }, 1500); 
};