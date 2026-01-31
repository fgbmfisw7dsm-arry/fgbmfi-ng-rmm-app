export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN'
    }).format(amount);
};

/**
 * Generates a deterministic 4-digit code from a Delegate ID and Event ID.
 * This ensures the code is event-scoped and memorable.
 */
export const generateCodeFromId = (delegateId: string, eventId: string): string => {
    if (!delegateId || !eventId) return "0000";
    
    // Combine IDs to create a unique event-delegate salt
    const salt = delegateId + eventId;
    let hash = 0;
    for (let i = 0; i < salt.length; i++) {
        const char = salt.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    // Convert to 4-digit numeric string (0001 - 9999)
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

/**
 * Robustly exports a given HTML element to a PDF.
 * FIXED: Reduced scale to 1 to avoid blank pages on large reports (Master List / Detailed Reports)
 * which often exceed browser canvas size limits.
 */
export const exportToPDF = (element: HTMLElement, filename: string, orientation: 'portrait' | 'landscape') => {
    if (!element) {
        console.error("PDF export failed: The provided element is invalid.");
        return;
    }

    // Scroll to top to ensure capture starts from the beginning
    window.scrollTo(0, 0);

    // Deep clone the node for processing
    const nodeToPrint = element.cloneNode(true) as HTMLElement;
    
    // Force the removal of any potential ID collisions and add print-mode class
    nodeToPrint.classList.add('print-mode');
    nodeToPrint.style.width = orientation === 'landscape' ? '1200px' : '800px';

    // Create a temporary visible container far off-screen
    const printContainer = document.createElement('div');
    printContainer.id = 'pdf-export-container';
    printContainer.style.position = 'fixed';
    printContainer.style.left = '-10000px';
    printContainer.style.top = '0';
    printContainer.style.width = orientation === 'landscape' ? '1250px' : '850px';
    printContainer.style.background = '#ffffff';
    printContainer.style.zIndex = '-9999';
    printContainer.style.overflow = 'visible';
    
    printContainer.appendChild(nodeToPrint);
    document.body.appendChild(printContainer);

    // html2pdf options optimized for large FGBMFI reports
    const options = {
        margin: [10, 5, 15, 5],
        filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { 
            scale: 1, // REDUCED FROM 2 TO 1: Vital for large tables to prevent blank pages
            useCORS: true, 
            logging: false,
            letterRendering: true,
            allowTaint: false,
            backgroundColor: '#ffffff'
        },
        jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: orientation, 
            compress: true 
        }
    };

    // Use a longer delay to ensure large DOM structures are fully painted
    setTimeout(() => {
        // @ts-ignore
        window.html2pdf().from(nodeToPrint).set(options).save().then(() => {
            if (printContainer.parentNode) document.body.removeChild(printContainer);
        }).catch((error: any) => {
            console.error("PDF engine failure:", error);
            if (printContainer.parentNode) document.body.removeChild(printContainer);
        });
    }, 2000); 
};