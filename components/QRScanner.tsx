import React, { useEffect, useRef, useState } from 'react';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [useHtml5Fallback, setUseHtml5Fallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    mountedRef.current = true;
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tryHtml5Qrcode = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const cameras = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;
        if (cameras.length === 0) {
          setError('No camera detected.');
          return;
        }
        const rear = cameras.find((c: { id: string; label: string }) =>
          c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment')
        );
        const cameraId = rear?.id || cameras[0].id;
        setUseHtml5Fallback(true);
        setScanning(true);
        setError('');

        await new Promise(r => setTimeout(r, 100));

        const scanner = new Html5Qrcode('qr-scanner-view');
        await scanner.start(
          cameraId,
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            setScanning(false);
            scanner.stop().catch(() => {});
            onScanRef.current(decodedText.trim());
          },
          () => {}
        );
      } catch (e: any) {
        if (mountedRef.current) {
          setError(e.message || 'Failed to start camera.');
          setScanning(false);
        }
      }
    };

    const startBarcodeDetector = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
        if (!mountedRef.current || !videoRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
        setScanning(true);
        setError('');

        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });

        intervalId = setInterval(async () => {
          if (!mountedRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0) {
              if (intervalId) clearInterval(intervalId);
              if (stream) stream.getTracks().forEach(t => t.stop());
              setScanning(false);
              onScanRef.current(codes[0].rawValue);
            }
          } catch (_e) {}
        }, 120);
      } catch (e: any) {
        if (mountedRef.current) {
          const msg = e.message || '';
          if (msg.includes('Permission') || msg.includes('NotAllowed')) {
            setError('Camera access denied. Grant camera permission in settings.');
          } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
            setError('No camera detected on this device.');
          } else {
            setError(msg || 'Failed to start camera.');
          }
          setScanning(false);
        }
      }
    };

    if ('BarcodeDetector' in window) {
      startBarcodeDetector();
    } else {
      tryHtml5Qrcode();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="p-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-sm font-black text-blue-900 uppercase tracking-wider">Scan QR Code</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="p-4">
          {useHtml5Fallback ? (
            <div id="qr-scanner-view" className="w-full bg-black rounded-2xl overflow-hidden" style={{ minHeight: 280 }} />
          ) : (
            <video ref={videoRef} className="w-full bg-black rounded-2xl" style={{ minHeight: 280, objectFit: 'cover' }} playsInline autoPlay muted />
          )}
          {error && (
            <div className="mt-3 p-3 bg-red-50 rounded-xl text-xs font-bold text-red-600 text-center">
              {error}
            </div>
          )}
          {scanning && !error && (
            <div className="mt-3 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Scanning...</span>
            </div>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-blue-900 hover:bg-blue-800 text-white font-black rounded-xl text-[10px] uppercase tracking-widest transition-all">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
