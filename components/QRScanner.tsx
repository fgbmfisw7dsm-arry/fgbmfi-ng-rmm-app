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

const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || '';
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return true;
  if (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && /macintosh|windows/i.test(ua)) return true;
  return false;
};

const facingForDevice = (): 'environment' | 'user' => isMobileDevice() ? 'environment' : 'user';

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [useHtml5Fallback, setUseHtml5Fallback] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [, setCameras] = useState<CameraInfo[]>([]);
  const [forceHtml5, setForceHtml5] = useState(false);
  const [boost, setBoost] = useState(false);
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  const onScanRef = useRef(onScan);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const html5ScannerRef = useRef<any>(null);
  const attemptsRef = useRef(0);
  const camerasRef = useRef<CameraInfo[]>([]);
  const forceHtml5Ref = useRef(false);
  const boostRef = useRef(false);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const log = useCallback((msg: string) => {
    console.log('[QRScanner]', msg);
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  }, []);

  const switchingRef = useRef(false);

  const isVirtualDevice = useCallback((label: string): boolean => {
    const l = label.toLowerCase();
    return (
      l.includes('obs') || l.includes('virtual') || l.includes('simulator') ||
      l.includes('vcam') || l.includes('nvidia broadcast') || l.includes('stream') ||
      l.includes('prism') || l.includes('splitcam') || l.includes('manycam') ||
      l.includes('xsplit') || l.includes('screen') || l.includes('display') ||
      l.includes('monitor')
    );
  }, []);

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`
        }))
        .sort((a, b) => {
          const va = isVirtualDevice(a.label) ? 1 : 0;
          const vb = isVirtualDevice(b.label) ? 1 : 0;
          return va - vb;
        });
      camerasRef.current = videoDevices;
      setCameras(videoDevices);
    } catch {}
  }, [isVirtualDevice]);

  const pickCameraForFacing = useCallback((facing: 'environment' | 'user'): string | null => {
    const hints = facing === 'environment'
      ? ['back', 'rear', 'environment']
      : ['front', 'user', 'built-in', 'face', 'facetime', 'integrated', 'builtin'];
    const physical = camerasRef.current.filter(c => !isVirtualDevice(c.label));
    return physical.find(c => hints.some(h => c.label.toLowerCase().includes(h)))?.deviceId
      ?? physical[0]?.deviceId
      ?? camerasRef.current[0]?.deviceId
      ?? null;
  }, [isVirtualDevice]);

  const probeAndRefreshCameras = useCallback(async (): Promise<void> => {
    const probe = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        await new Promise(r => setTimeout(r, 150));
        s.getTracks().forEach(t => t.stop());
      } catch {}
      await new Promise(r => setTimeout(r, 200));
      await refreshCameras();
    };
    await probe();
  }, [refreshCameras]);

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

  const applyCameraControls = useCallback(async (track: MediaStreamTrack, lowLight: boolean) => {
    try {
      const capabilities = (track.getCapabilities ? track.getCapabilities() : null) as unknown as CameraCapabilities | null;
      if (!capabilities) return;
      const advanced: any[] = [];
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
      }
      if (lowLight) {
        if (capabilities.exposureCompensation) {
          const r = capabilities.exposureCompensation;
          if (typeof r.max === 'number' && typeof r.min === 'number') {
            advanced.push({ exposureCompensation: Math.min(r.max, r.min + (r.max - r.min) * 0.25) });
          }
        }
        if (capabilities.brightness) {
          const r = capabilities.brightness;
          if (typeof r.max === 'number' && typeof r.min === 'number') {
            advanced.push({ brightness: Math.min(r.max, (r.min + r.max) / 2 + (r.max - r.min) * 0.25) });
          }
        }
        if (capabilities.contrast) {
          const r = capabilities.contrast;
          if (typeof r.max === 'number' && typeof r.min === 'number') {
            advanced.push({ contrast: Math.min(r.max, (r.min + r.max) / 2 + (r.max - r.min) * 0.25) });
          }
        }
        if (capabilities.sharpness && typeof capabilities.sharpness.max === 'number') {
          advanced.push({ sharpness: capabilities.sharpness.max });
        }
      }
      if (advanced.length) {
        await track.applyConstraints({ advanced });
      }
    } catch {}
  }, []);

  const startBarcodeDetector = useCallback(async (deviceId?: string | null) => {
    const facing = facingForDevice();
    try {
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        throw new Error('BarcodeDetector unavailable');
      }
      const videoConstraints: any = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: { ideal: 'continuous' }
      };
      if (deviceId) {
        const labelsKnown = camerasRef.current.some(c => c.label && !/^Camera \d+$/.test(c.label));
        const camLabel = camerasRef.current.find(c => c.deviceId === deviceId)?.label || '';
        videoConstraints.deviceId = labelsKnown ? { exact: deviceId } : { ideal: deviceId };
        log(`Camera: ${camLabel || deviceId.slice(0, 8)}`);
      } else {
        videoConstraints.facingMode = facing;
        log(`Camera: auto ${facing === 'environment' ? 'Back' : 'Front'} (facingMode)`);
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
      const actualId = track?.getSettings?.().deviceId || '';
      const actualLabel = camerasRef.current.find(c => c.deviceId === actualId)?.label || '';
      setActiveCameraLabel(actualLabel || '');
      if (track) {
        const caps = (track.getCapabilities ? track.getCapabilities() : null) as unknown as CameraCapabilities | null;
        if (caps) {
          log(`Camera max: ${caps.width?.max}x${caps.height?.max}`);
          const capsMsg: string[] = [];
          if (caps.focusMode) capsMsg.push(`focus=${caps.focusMode.join(',')}`);
          if (caps.focusDistance) capsMsg.push(`distance=${caps.focusDistance.min}-${caps.focusDistance.max}`);
          if (caps.exposureCompensation) capsMsg.push(`expComp=${caps.exposureCompensation.min}-${caps.exposureCompensation.max}`);
          if (capsMsg.length) log(`Capabilities: ${capsMsg.join(', ')}`);
        }
        await applyCameraControls(track, boostRef.current);
        log(`Controls applied (continuous focus/exposure${boostRef.current ? ' + low-light boost' : ''})`);
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
          ctx.filter = boostRef.current ? 'brightness(1.2) contrast(1.25)' : 'none';
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
          } else if (attemptsRef.current === 400) {
            log('No code found after 20s — possible dead/blank camera feed. Stopping.');
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setScanning(false);
            setError('No code detected after 20 seconds. Check that your webcam is producing a live image, then try again.');
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
          log(`Camera error: ${msg || 'unknown'}. Falling back to auto-selected camera...`);
          setError('');
          const fallbackId = pickCameraForFacing(facing);
          if (!deviceId && fallbackId) {
            setTimeout(() => startBarcodeDetector(fallbackId), 500);
          } else {
            setError('Failed to start the camera. Please try again.');
          }
        }
        setScanning(false);
      }
    }
  }, [log, refreshCameras, applyCameraControls, pickCameraForFacing]);

  const tryHtml5Qrcode = useCallback(async (deviceId?: string | null) => {
    const facing = facingForDevice();
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      const cameraSelection: any = deviceId
        ? deviceId
        : { facingMode: facing };
      if (deviceId) {
        const camLabel = camerasRef.current.find(c => c.deviceId === deviceId)?.label || deviceId.slice(0, 8);
        log(`Camera: ${camLabel}`);
        setActiveCameraLabel(camerasRef.current.find(c => c.deviceId === deviceId)?.label || '');
      } else {
        log(`Camera: auto ${facing === 'environment' ? 'Back' : 'Front'} (facingMode)`);
        setActiveCameraLabel(facing === 'environment' ? 'Back Camera' : 'Front Camera');
      }

      setScanning(true);
      setError('');

      await new Promise(r => setTimeout(r, 150));
      const scanner = new Html5Qrcode('qr-scanner-view', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false
      });
      const h5VideoConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: { ideal: 'continuous' } as any
      };
      await scanner.start(
        cameraSelection,
        {
          fps: 25,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.65;
            return { width: size, height: size };
          },
          videoConstraints: h5VideoConstraints as any
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
          log('html5-qrcode camera not found, retrying...');
          setError('');
          if (deviceId) {
            setTimeout(() => tryHtml5Qrcode(null), 500);
          } else {
            const fallbackId = pickCameraForFacing(facing);
            if (fallbackId) {
              setTimeout(() => tryHtml5Qrcode(fallbackId), 500);
            } else {
              setError('No camera detected.');
              setScanning(false);
            }
          }
        } else {
          log(`html5-qrcode error: ${msg || 'unknown'}`);
          if (deviceId) {
            setError('');
            setScanning(false);
            setTimeout(() => tryHtml5Qrcode(null), 500);
          } else {
            setError(msg || 'Failed to start camera.');
            setScanning(false);
          }
        }
      }
    }
  }, [log, refreshCameras, isVirtualDevice, pickCameraForFacing]);

  const startWithEngine = useCallback(async (deviceId: string | null) => {
    if (forceHtml5Ref.current) {
      setUseHtml5Fallback(true);
      await tryHtml5Qrcode(deviceId);
    } else {
      setUseHtml5Fallback(false);
      await startBarcodeDetector(deviceId);
    }
  }, [startBarcodeDetector, tryHtml5Qrcode]);

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
      await startWithEngine(null);
    } finally {
      switchingRef.current = false;
    }
  }, [stopScanner, startWithEngine]);

  const toggleBoost = useCallback(async () => {
    const next = !boostRef.current;
    boostRef.current = next;
    setBoost(next);
    localStorage.setItem('qr-lowlight-boost', String(next));
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) await applyCameraControls(track, next);
    }
  }, [applyCameraControls]);

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
          }))
          .sort((a, b) => {
            const va = isVirtualDevice(a.label) ? 1 : 0;
            const vb = isVirtualDevice(b.label) ? 1 : 0;
            return va - vb;
          });
        camerasRef.current = videoDevices;
        setCameras(videoDevices);

        await probeAndRefreshCameras();

        const savedForceHtml5 = localStorage.getItem('qr-force-html5') === 'true';
        forceHtml5Ref.current = savedForceHtml5 || !('BarcodeDetector' in window);
        setForceHtml5(savedForceHtml5);

        const savedBoost = localStorage.getItem('qr-lowlight-boost') === 'true';
        boostRef.current = savedBoost;
        setBoost(savedBoost);

        if (started) return;
        started = true;

        await startWithEngine(null);
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
  }, [startWithEngine, probeAndRefreshCameras, isVirtualDevice]);

  const hasBarcodeDetector = 'BarcodeDetector' in window;

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:bg-black/80 md:items-center md:justify-center md:p-4">
      <div className="flex flex-col flex-1 md:flex-initial md:max-w-md md:w-full md:rounded-2xl md:overflow-hidden md:shadow-2xl md:border md:border-gray-700 bg-black">
      {useHtml5Fallback ? (
        <div className="relative flex-1 md:h-72">
          <div id="qr-scanner-view" className="absolute inset-0" />
          {activeCameraLabel && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 z-50 pointer-events-none">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="bg-black/70 text-white text-[10px] font-medium rounded-full px-2 py-1 truncate max-w-[150px]">
                {activeCameraLabel}
              </span>
            </div>
          )}
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
          {activeCameraLabel && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 z-50 pointer-events-none">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="bg-black/70 text-white text-[10px] font-medium rounded-full px-2 py-1 truncate max-w-[150px]">
                {activeCameraLabel}
              </span>
            </div>
          )}
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
        <div className="flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={toggleBoost}
            className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
              boost
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={boost ? 'Low light boost ON — tap to disable' : 'Low light boost OFF — tap to brighten dark scenes'}
          >
            {boost ? 'Boost ON' : 'Boost'}
          </button>
          {hasBarcodeDetector && (
            <button
              onClick={toggleEngine}
              className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                forceHtml5
                  ? 'bg-yellow-600/40 hover:bg-yellow-600/60 text-yellow-300'
                  : 'bg-blue-600/40 hover:bg-blue-600/60 text-blue-300'
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
