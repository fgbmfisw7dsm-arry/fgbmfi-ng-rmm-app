import React, { useCallback, useEffect, useRef, useState } from 'react';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

interface CameraInfo {
  deviceId: string;
  label: string;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [useHtml5Fallback, setUseHtml5Fallback] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [showCameraMenu, setShowCameraMenu] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  const onScanRef = useRef(onScan);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const html5ScannerRef = useRef<any>(null);
  const attemptsRef = useRef(0);
  const camerasRef = useRef<CameraInfo[]>([]);

  const log = (msg: string) => {
    console.log('[QRScanner]', msg);
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  };

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopScanner = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (html5ScannerRef.current) {
      try { await html5ScannerRef.current.stop(); } catch {}
      html5ScannerRef.current = null;
    }
  }, []);

  const startBarcodeDetector = useCallback(async (deviceId?: string | null) => {
    try {
      const videoConstraints: any = {
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      };
      if (deviceId) {
        videoConstraints.deviceId = { exact: deviceId };
      } else {
        videoConstraints.facingMode = 'environment';
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      streamRef.current = stream;

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

      attemptsRef.current = 0;
      intervalRef.current = setInterval(async () => {
        if (!mountedRef.current || !videoRef.current) return;
        attemptsRef.current++;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            setScanning(false);
            onScanRef.current(codes[0].rawValue.trim());
          } else if (attemptsRef.current % 40 === 0) {
            log(`Scanning... ${attemptsRef.current} attempts, try moving badge closer`);
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
          log(`Camera error, retrying with default...`);
          setError('');
          setTimeout(() => startBarcodeDetector(null), 300);
        }
        setScanning(false);
      }
    }
  }, [log]);

  const tryHtml5Qrcode = useCallback(async (deviceId?: string | null) => {
    try {
      log('Falling back to html5-qrcode...');
      const { Html5Qrcode } = await import('html5-qrcode');

      let cameraId: string;
      if (deviceId) {
        cameraId = deviceId;
        const camLabel = camerasRef.current.find(c => c.deviceId === deviceId)?.label || deviceId.slice(0, 8);
        log(`Camera: ${camLabel}`);
      } else {
        const camList = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;
        if (camList.length === 0) {
          setError('No camera detected.');
          return;
        }
        const rear = camList.find((c: { id: string; label: string }) =>
          c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment')
        );
        cameraId = rear?.id || camList[0].id;
        log(`Camera: ${rear?.label || camList[0].label}`);
      }

      setUseHtml5Fallback(true);
      setScanning(true);
      setError('');

      await new Promise(r => setTimeout(r, 150));
      const scanner = new Html5Qrcode('qr-scanner-view');
      html5ScannerRef.current = scanner;
      await scanner.start(
        cameraId,
        { fps: 10, qrbox: 250 },
        (decodedText: string) => {
          setScanning(false);
          scanner.stop().catch(() => {});
          html5ScannerRef.current = null;
          onScanRef.current(decodedText.trim());
        },
        () => {}
      );
      log('html5-qrcode scanner active');
    } catch (e: any) {
      if (mountedRef.current) {
        if (e.message && e.message.includes('NotFound')) {
          log('html5-qrcode camera not found, retrying with default...');
          setError('');
          setTimeout(() => tryHtml5Qrcode(null), 300);
        } else {
          setError(e.message || 'Failed to start camera.');
        }
        setScanning(false);
      }
    }
  }, [log]);

  const switchCamera = useCallback(async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    localStorage.setItem('qr-camera-device-id', deviceId);
    setShowCameraMenu(false);
    setScanning(false);
    setError('');
    await stopScanner();
    if (!mountedRef.current) return;
    if ('BarcodeDetector' in window) {
      await startBarcodeDetector(deviceId);
    } else {
      await tryHtml5Qrcode(deviceId);
    }
  }, [stopScanner, startBarcodeDetector, tryHtml5Qrcode]);

  useEffect(() => {
    mountedRef.current = true;
    let started = false;

    const init = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!mountedRef.current) return;
        const videoDevices = devices
          .filter(d => d.kind === 'videoinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`
          }));
        camerasRef.current = videoDevices;
        setCameras(videoDevices);

        const saved = localStorage.getItem('qr-camera-device-id');
        const initialCamera = saved && videoDevices.some(d => d.deviceId === saved) ? saved : null;
        setSelectedCameraId(initialCamera);

        if (started) return;
        started = true;

        if ('BarcodeDetector' in window) {
          await startBarcodeDetector(initialCamera);
        } else {
          await tryHtml5Qrcode(initialCamera);
        }
      } catch {
        if (!started) {
          started = true;
          if ('BarcodeDetector' in window) {
            await startBarcodeDetector(null);
          } else {
            await tryHtml5Qrcode(null);
          }
        }
      }
    };

    init();

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (html5ScannerRef.current) {
        html5ScannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const activeLabel = cameras.find(c => c.deviceId === selectedCameraId)?.label;

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:bg-black/80 md:items-center md:justify-center md:p-4">
      <div className="flex flex-col flex-1 md:flex-initial md:max-w-md md:w-full md:rounded-2xl md:overflow-hidden md:shadow-2xl md:border md:border-gray-700 bg-black">
      {useHtml5Fallback ? (
        <div className="relative flex-1 md:h-72">
          <div id="qr-scanner-view" className="absolute inset-0" />
          <div className="absolute inset-0 border-[3px] border-white/30 rounded-3xl m-8 pointer-events-none" />
          {cameras.length > 1 && (
            <>
              <button
                onClick={() => setShowCameraMenu(!showCameraMenu)}
                className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-colors"
                title="Switch camera"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 7l-5 5 5 5" />
                  <path d="M1 17l5-5-5-5" />
                  <path d="M3 7h1a8 8 0 0 1 14.5 4M3 17h16a5 5 0 0 0 2-9.5" />
                </svg>
              </button>
              {showCameraMenu && (
                <div className="absolute top-12 right-3 z-20 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[180px]">
                  {cameras.map(cam => (
                    <button
                      key={cam.deviceId}
                      onClick={() => switchCamera(cam.deviceId)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/10 transition-colors ${
                        cam.deviceId === selectedCameraId ? 'text-white font-bold' : 'text-gray-400'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        cam.deviceId === selectedCameraId ? 'bg-blue-400' : 'bg-gray-600'
                      }`} />
                      <span className="truncate">{cam.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
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
          {cameras.length > 1 && (
            <>
              <button
                onClick={() => setShowCameraMenu(!showCameraMenu)}
                className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-colors"
                title="Switch camera"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 7l-5 5 5 5" />
                  <path d="M1 17l5-5-5-5" />
                  <path d="M3 7h1a8 8 0 0 1 14.5 4M3 17h16a5 5 0 0 0 2-9.5" />
                </svg>
              </button>
              {showCameraMenu && (
                <div className="absolute top-12 right-3 z-20 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[180px]">
                  {cameras.map(cam => (
                    <button
                      key={cam.deviceId}
                      onClick={() => switchCamera(cam.deviceId)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/10 transition-colors ${
                        cam.deviceId === selectedCameraId ? 'text-white font-bold' : 'text-gray-400'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        cam.deviceId === selectedCameraId ? 'bg-blue-400' : 'bg-gray-600'
                      }`} />
                      <span className="truncate">{cam.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-black/90 px-6 py-4 flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          {scanning && !error && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-bold text-white uppercase tracking-widest">Scanning...</span>
            </div>
          )}
          {error && <span className="text-xs font-bold text-red-400 truncate">{error}</span>}
          {activeLabel && cameras.length > 1 && !scanning && !error && (
            <span className="text-[10px] text-gray-500 truncate">{activeLabel}</span>
          )}
        </div>
        <button onClick={onClose} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs uppercase tracking-widest transition-all flex-shrink-0 ml-3">
          Cancel
        </button>
      </div>
      </div>
    </div>
  );
};

export default QRScanner;
