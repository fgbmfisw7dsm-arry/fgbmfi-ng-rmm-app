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
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  const log = (msg: string) => {
    console.log('[QRScanner]', msg);
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  };

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    mountedRef.current = true;
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;

    const tryHtml5Qrcode = async () => {
      try {
        log('Falling back to html5-qrcode...');
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
        log(`Camera: ${rear?.label || cameras[0].label}`);
        setUseHtml5Fallback(true);
        setScanning(true);
        setError('');

        await new Promise(r => setTimeout(r, 150));
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
        log('html5-qrcode scanner active');
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
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });
        if (!mountedRef.current || !videoRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        log(`Video: ${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);

        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities = track.getCapabilities ? track.getCapabilities() : null;
          if (capabilities) {
            log(`Camera max: ${capabilities.width?.max}x${capabilities.height?.max}`);
          }
        }

        setScanning(true);
        setError('');

        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        log('BarcodeDetector active, hold badge closer...');

        intervalId = setInterval(async () => {
          if (!mountedRef.current || !videoRef.current) return;
          attempts++;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0) {
              if (intervalId) clearInterval(intervalId);
              if (stream) stream.getTracks().forEach(t => t.stop());
              setScanning(false);
              onScanRef.current(codes[0].rawValue.trim());
            } else if (attempts % 40 === 0) {
              log(`Scanning... ${attempts} attempts, try moving badge closer`);
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
    return () => { mountedRef.current = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:bg-black/80 md:items-center md:justify-center md:p-4">
      <div className="flex flex-col flex-1 md:flex-initial md:max-w-md md:w-full md:rounded-2xl md:overflow-hidden md:shadow-2xl md:border md:border-gray-700 bg-black">
      {useHtml5Fallback ? (
        <div className="relative flex-1 md:h-72">
          <div id="qr-scanner-view" className="absolute inset-0" />
          <div className="absolute inset-0 border-[3px] border-white/30 rounded-3xl m-8 pointer-events-none" />
        </div>
      ) : (
        <div className="relative flex-1 md:h-72">
          <video ref={videoRef} className="absolute inset-0 w-full h-full" style={{ objectFit: 'cover' }} playsInline autoPlay muted />
          <div className="absolute inset-0 border-[3px] border-white/30 rounded-3xl m-8 pointer-events-none" />
          <div className="absolute top-4 left-4 right-4">
            {debugInfo.length > 0 && (
              <div className="bg-black/50 rounded-lg p-1.5">
                {debugInfo.map((line, i) => (
                  <div key={i} className="text-[8px] font-mono text-green-400 leading-relaxed">{line}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-black/90 px-6 py-4 flex items-center justify-between">
        <div className="flex flex-col">
          {scanning && !error && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-bold text-white uppercase tracking-widest">Scanning...</span>
            </div>
          )}
          {error && <span className="text-xs font-bold text-red-400">{error}</span>}
        </div>
        <button onClick={onClose} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs uppercase tracking-widest transition-all">
          Cancel
        </button>
      </div>
      </div>
    </div>
  );
};

export default QRScanner;
