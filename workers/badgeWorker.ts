import { generateBadgePDF } from '../services/badgePdfGenerator';
import { Delegate, Event, BadgeLayout, BadgeGenerationProgress } from '../types';

interface WorkerMessage {
  type: 'GENERATE';
  delegates: Delegate[];
  layout: BadgeLayout;
  event: Event;
  logoBase64?: string;
}

interface WorkerResponse {
  type: 'PROGRESS';
  progress: BadgeGenerationProgress;
}

interface WorkerCompleteResponse {
  type: 'COMPLETE';
  pdfBytes: ArrayBuffer;
}

interface WorkerErrorResponse {
  type: 'ERROR';
  message: string;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type !== 'GENERATE') return;

  try {
    let logoBytes: Uint8Array | undefined;
    if (msg.logoBase64) {
      try {
        const base64 = msg.logoBase64.includes(',')
          ? msg.logoBase64.split(',')[1]
          : msg.logoBase64;
        const binary = atob(base64);
        logoBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          logoBytes[i] = binary.charCodeAt(i);
        }
      } catch {}
    }

    const pdfBytes = await generateBadgePDF(
      msg.delegates,
      msg.layout,
      msg.event,
      logoBytes,
      (progress: BadgeGenerationProgress) => {
        const response: WorkerResponse = {
          type: 'PROGRESS',
          progress,
        };
        self.postMessage(response);
      }
    );

    const completeResponse: WorkerCompleteResponse = {
      type: 'COMPLETE',
      pdfBytes: pdfBytes.buffer as ArrayBuffer,
    };
    (self as any).postMessage(completeResponse);
  } catch (err: any) {
    const errorResponse: WorkerErrorResponse = {
      type: 'ERROR',
      message: err?.message || 'PDF generation failed',
    };
    self.postMessage(errorResponse);
  }
};
