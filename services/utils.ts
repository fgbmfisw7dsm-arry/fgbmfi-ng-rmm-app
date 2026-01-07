
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
 * Robustly exports a given HTML element to a PDF, ensuring the full content is captured.
 */
export const exportToPDF = (element: HTMLElement, filename: string, orientation: 'portrait' | 'landscape') => {
    if (!element) {
        console.error("PDF export failed: The provided element is invalid.");
        return;
    }

    window.scrollTo(0, 0);
    const nodeToPrint = element.cloneNode(true) as HTMLElement;
    nodeToPrint.classList.add('print-mode');

    const printContainer = document.createElement('div');
    printContainer.style.position = 'fixed';
    printContainer.style.top = '0';
    printContainer.style.left = '0';
    printContainer.style.zIndex = '-1000';
    printContainer.style.background = '#ffffff';
    
    // Use wider capture area for landscape to ensure right-most columns aren't clipped
    const containerWidth = orientation === 'landscape' ? 1550 : 1000;
    printContainer.style.width = `${containerWidth}px`;
    printContainer.style.height = 'auto';
    printContainer.style.overflow = 'visible';
    
    printContainer.appendChild(nodeToPrint);
    document.body.appendChild(printContainer);

    const options = {
        // [top, left, bottom, right] in mm
        margin: [10, 5, 20, 5],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true, 
            logging: false,
            scrollY: 0,
            scrollX: 0,
            windowWidth: containerWidth,
            width: containerWidth
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: orientation, compress: true }
    };

    setTimeout(() => {
        // @ts-ignore
        window.html2pdf().from(nodeToPrint).set(options).save().then(() => {
            document.body.removeChild(printContainer);
        }).catch((error: any) => {
            console.error("An error occurred during PDF generation:", error);
            document.body.removeChild(printContainer);
        });
    }, 1000);
};
