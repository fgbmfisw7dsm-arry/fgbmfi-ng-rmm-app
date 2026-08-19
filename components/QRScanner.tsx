import React, { useCallback, useEffect, useRef, useState } from 'react';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

interface CameraInfo {
  deviceId: string;
  label: string;
}

interface CameraCapabilities {
  width?: ConstrainDoubleRange;
  height?: ConstrainDoubleRange;
  focusMode?: string[];
  focusDistance?: ConstrainDoubleRange;
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  exposureCompensation?: ConstrainDoubleRange;
  brightness?: ConstrainDoubleRange;
  contrast?: ConstrainDoubleRange;
  sharpness?: ConstrainDoubleRange;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [useHtml5Fallback, setUseHtml5Fallback] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [forceHtml5, setForceHtml5] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  const onScanRef = useRef(onScan);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const html5ScannerRef = useRef<any>(null);
  const attemptsRef = useRef(0);
  const camerasRef = useRef<CameraInfo[]>([]);
  const forceHtml5Ref = useRef(false);
  const selectedCameraRef = useRef<string | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const log = useCallback((msg: string) => {
    console.log('[QRScanner]', msg);
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  }, []);

  const switchingRef = useRef(false);

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`
        }));
      camerasRef.current = videoDevices;
      setCameras(videoDevices);
    } catch {}
  }, []);

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
    await new Promise(r => setTimeout(r, 200));
  }, []);

  const startBarcodeDetector = useCallback(async (deviceId?: string | null) => {
    try {
      const videoConstraints: any = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: { ideal: 'continuous' }
      };
      if (deviceId) {
        videoConstraints.deviceId = { ideal: deviceId };
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

      if (!scanCanvasRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        scanCanvasRef.current = canvas;
        scanCtxRef.current = canvas.getContext('2d', { willReadFrequently: true });
      }

      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track.getCapabilities ? track.getCapabilities() : null) as unknown as CameraCapabilities | null;
        if (capabilities) {
          log(`Camera max: ${capabilities.width?.max}x${capabilities.height?.max}`);
          const capsMsg: string[] = [];
          if (capabilities.focusMode) capsMsg.push(`focus=${capabilities.focusMode.join(',')}`);
          if (capabilities.focusDistance) capsMsg.push(`distance=${capabilities.focusDistance.min}-${capabilities.focusDistance.max}`);
          if (capsMsg.length) log(`Capabilities: ${capsMsg.join(', ')}`);
          if (capabilities.focusDistance) {
            try {
              await track.applyConstraints({ advanced: [{ focusDistance: capabilities.focusDistance.min } as any] });
              log(`Focus set to min: ${capabilities.focusDistance.min}`);
            } catch {}
          }
          if (capabilities.exposureMode) {
            try {
              await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' } as any] });
            } catch {}
          }
        }
      }

      refreshCameras();

      setScanning(true);
      setError('');

      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      log('BarcodeDetector active (50ms region scan), hold badge in focus zone...');

      attemptsRef.current = 0;
      let detecting = false;
      intervalRef.current = setInterval(async () => {
        if (detecting || !mountedRef.current || !videoRef.current) return;
        detecting = true;
        attemptsRef.current++;
        try {
          const video = videoRef.current;
          const canvas = scanCanvasRef.current;
          const ctx = scanCtxRef.current;
          if (!canvas || !ctx || !video.videoWidth || !video.videoHeight) return;
          const size = Math.min(video.videoWidth, video.videoHeight);
          const sx = (video.videoWidth - size) / 2;
          const sy = (video.videoHeight - size) / 2;
          ctx.save();
          ctx.filter = 'none';
          ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          const codes = await detector.detect(canvas);
          if (codes && codes.length > 0) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            setScanning(false);
            onScanRef.current(codes[0].rawValue.trim());
          } else if (attemptsRef.current % 100 === 0) {
            log(`Scanning... ${attemptsRef.current} attempts, hold badge in focus zone`);
          }
        } catch (_e) {}
        detecting = false;
      }, 50);
    } catch (e: any) {
      if (mountedRef.current) {
        const msg = e.message || '';
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera access denied. Grant camera permission in settings.');
        } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
          setError('No camera detected on this device.');
        } else {
          const camLabel = deviceId ? camerasRef.current.find(c => c.deviceId === deviceId)?.label : null;
          log(`Camera error${camLabel ? ' (' + camLabel + ')' : ''}: ${msg || 'unknown'}. Falling back to default...`);
          setError('');
          if (deviceId) {
            localStorage.removeItem('qr-camera-device-id');
            selectedCameraRef.current = null;
            setSelectedCameraId(null);
          }
          setTimeout(() => startBarcodeDetector(null), 500);
        }
        setScanning(false);
      }
    }
  }, [log, refreshCameras]);

  const tryHtml5Qrcode = useCallback(async (deviceId?: string | null) => {
    try {
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

      setScanning(true);
      setError('');

      await new Promise(r => setTimeout(r, 150));
      const scanner = new Html5Qrcode('qr-scanner-view');
      await scanner.start(
        cameraId,
        {
          fps: 20,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.65;
            return { width: size, height: size };
          }
        },
        (decodedText: string) => {
          setScanning(false);
          scanner.stop().catch(() => {});
          html5ScannerRef.current = null;
          onScanRef.current(decodedText.trim());
        },
        () => {}
      );
      log('html5-qrcode active (20fps)');
      html5ScannerRef.current = scanner;
      refreshCameras();
    } catch (e: any) {
      html5ScannerRef.current = null;
      if (mountedRef.current) {
        const msg = e.message || '';
        if (msg.includes('NotFound')) {
          log('html5-qrcode camera not found, retrying with default...');
          setError('');
          if (deviceId) {
            localStorage.removeItem('qr-camera-device-id');
            selectedCameraRef.current = null;
            setSelectedCameraId(null);
          }
          setTimeout(() => tryHtml5Qrcode(null), 500);
        } else {
          log(`html5-qrcode error: ${msg || 'unknown'}`);
          if (deviceId) {
            localStorage.removeItem('qr-camera-device-id');
            selectedCameraRef.current = null;
            setSelectedCameraId(null);
            setScanning(false);
            setTimeout(() => tryHtml5Qrcode(null), 500);
          } else {
            setError(msg || 'Failed to start camera.');
            setScanning(false);
          }
        }
      }
    }
  }, [log, refreshCameras]);

  const startWithEngine = useCallback(async (deviceId: string | null) => {
    if (forceHtml5Ref.current) {
      setUseHtml5Fallback(true);
      await tryHtml5Qrcode(deviceId);
    } else {
      setUseHtml5Fallback(false);
      await startBarcodeDetector(deviceId);
    }
  }, [startBarcodeDetector, tryHtml5Qrcode]);

  const switchCamera = useCallback(async (deviceId: string) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      selectedCameraRef.current = deviceId;
      setSelectedCameraId(deviceId);
      localStorage.setItem('qr-camera-device-id', deviceId);
      setScanning(false);
      setError('');
      await stopScanner();
      if (!mountedRef.current) return;
      await startWithEngine(deviceId);
    } finally {
      switchingRef.current = false;
    }
  }, [stopScanner, startWithEngine]);

  const toggleEngine = useCallback(async () => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      const next = !forceHtml5Ref.current;
      forceHtml5Ref.current = next;
      setForceHtml5(next);
      localStorage.setItem('qr-force-html5', String(next));
      setScanning(false);
      setError('');
      await stopScanner();
      if (!mountedRef.current) return;
      await startWithEngine(selectedCameraRef.current);
    } finally {
      switchingRef.current = false;
    }
  }, [stopScanner, startWithEngine]);

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
        selectedCameraRef.current = initialCamera;
        setSelectedCameraId(initialCamera);

        const savedForceHtml5 = localStorage.getItem('qr-force-html5') === 'true';
        forceHtml5Ref.current = savedForceHtml5 || !('BarcodeDetector' in window);
        setForceHtml5(savedForceHtml5);

        if (started) return;
        started = true;

        await startWithEngine(initialCamera);
      } catch {
        if (!started) {
          started = true;
          forceHtml5Ref.current = !('BarcodeDetector' in window);
          await startWithEngine(null);
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
  }, [startWithEngine]);

  const hasBarcodeDetector = 'BarcodeDetector' in window;

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:bg-black/80 md:items-center md:justify-center md:p-4">
      <div className="flex flex-col flex-1 md:flex-initial md:max-w-md md:w-full md:rounded-2xl md:overflow-hidden md:shadow-2xl md:border md:border-gray-700 bg-black">
      {useHtml5Fallback ? (
        <div className="relative flex-1 md:h-72">
          <div id="qr-scanner-view" className="absolute inset-0" />
          <div className="absolute inset-0 border-[3px] border-white/30 rounded-3xl m-8 pointer-events-none" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute inset-[32px]">
              <div className="absolute top-0 left-0 w-5 h-5 border-t-[3px] border-l-[3px] border-cyan-300/80 rounded-tl" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-[3px] border-r-[3px] border-cyan-300/80 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-[3px] border-l-[3px] border-cyan-300/80 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-[3px] border-r-[3px] border-cyan-300/80 rounded-br" />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 md:h-72">
          <video ref={videoRef} className="absolute inset-0 w-full h-full" style={{ objectFit: 'cover' }} playsInline autoPlay muted />
          <div className="absolute inset-0 border-[3px] border-white/30 rounded-3xl m-8 pointer-events-none" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute inset-[32px]">
              <div className="absolute top-0 left-0 w-5 h-5 border-t-[3px] border-l-[3px] border-cyan-300/80 rounded-tl" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-[3px] border-r-[3px] border-cyan-300/80 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-[3px] border-l-[3px] border-cyan-300/80 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-[3px] border-r-[3px] border-cyan-300/80 rounded-br" />
            </div>
          </div>
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

      <div className="bg-black/90 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0 flex-1">
          {scanning && !error && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-bold text-white uppercase tracking-widest">
                Scanning... <span className="text-[10px] font-normal text-gray-400">{useHtml5Fallback ? 'H5' : 'BD'}</span>
              </span>
            </div>
          )}
          {error && <span className="text-xs font-bold text-red-400 truncate">{error}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {cameras.length > 1 && (
            <select
              value={selectedCameraId || ''}
              onChange={(e) => { const v = e.target.value; if (v) switchCamera(v); }}
              className="bg-gray-800 text-white text-[10px] font-medium rounded-lg px-2 py-2 border border-gray-600 max-w-[130px] truncate appearance-none cursor-pointer hover:border-gray-400 transition-colors"
            >
              {cameras.map(cam => (
                <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>
              ))}
            </select>
          )}
          {hasBarcodeDetector && (
            <button
              onClick={toggleEngine}
              className={`px-2.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                forceHtml5
                  ? 'bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300'
                  : 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-300'
              }`}
              title={forceHtml5 ? 'Switch to BarcodeDetector' : 'Switch to html5-qrcode'}
            >
              {forceHtml5 ? 'html5' : 'BD'}
            </button>
          )}
          <button onClick={onClose} className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-[10px] uppercase tracking-widest transition-all">
            Cancel
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default QRScanner;
