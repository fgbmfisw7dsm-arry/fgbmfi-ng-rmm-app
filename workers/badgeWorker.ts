import { generateBadgePDF } from '../services/badgePdfGenerator';
import { Delegate, Event, BadgeLayout, BadgeGenerationProgress } from '../types';

interface WorkerMessage {
  type: 'GENERATE';
  delegates: Delegate[];
  layout: BadgeLayout;
  event: Event;
  fgbmfiLogoBase64?: string;
  eventLogoBase64?: string;
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
    const decodeBase64 = (base64: string): Uint8Array | undefined => {
      try {
        const raw = base64.includes(',') ? base64.split(',')[1] : base64;
        const binary = atob(raw);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      } catch {
        return undefined;
      }
    };

    const fgbmfiLogoBytes = msg.fgbmfiLogoBase64 ? decodeBase64(msg.fgbmfiLogoBase64) : undefined;
    const eventLogoBytes = msg.eventLogoBase64 ? decodeBase64(msg.eventLogoBase64) : undefined;

    const pdfBytes = await generateBadgePDF(
      msg.delegates,
      msg.layout,
      msg.event,
      fgbmfiLogoBytes,
      eventLogoBytes,
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
