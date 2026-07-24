import React, { useEffect, useRef, useState } from 'react';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

declare class Html5Qrcode {
  constructor(elementId: string);
  start(cameraId: string, config: any, onSuccess: (text: string) => void, onError: (err: any) => void): Promise<void>;
  stop(): Promise<void>;
  static getCameras(): Promise<{ id: string; label: string }[]>;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const scannerRef = useRef<any>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const cameras = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;
        setCameras(cameras);
        if (cameras.length > 0) {
          const rear = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment'));
          setSelectedCamera(rear?.id || cameras[0].id);
        } else {
          setError('No camera detected on this device.');
        }
      } catch (e: any) {
        if (mountedRef.current) {
          setError(e.message || 'Camera access denied. Grant camera permission and try again.');
        }
      }
    };
    init();
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!selectedCamera || scanned) return;
    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (scannerRef.current) await scannerRef.current.stop();
        scannerRef.current = new Html5Qrcode('qr-scanner-view');
        setScanning(true);
        await scannerRef.current.start(
          selectedCamera,
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (text: string) => {
            if (scanned) return;
            setScanned(true);
            setScanning(false);
            scannerRef.current?.stop().catch(() => {});
            onScan(text.trim());
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
    startScanner();
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [selectedCamera, scanned, onScan]);

  const toggleCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex(c => c.id === selectedCamera);
    setSelectedCamera(cameras[(idx + 1) % cameras.length].id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="p-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-sm font-black text-blue-900 uppercase tracking-wider">Scan QR Code</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="p-4">
          <div id="qr-scanner-view" className="w-full aspect-square bg-black rounded-2xl overflow-hidden" />
          {error && (
            <div className="mt-3 p-3 bg-red-50 rounded-xl text-xs font-bold text-red-600 text-center">
              {error}
            </div>
          )}
          {scanned && (
            <div className="mt-3 p-3 bg-green-50 rounded-xl text-xs font-bold text-green-600 text-center animate-in zoom-in">
              Code detected! Processing...
            </div>
          )}
          {scanning && !scanned && (
            <div className="mt-3 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Scanning...</span>
            </div>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-3">
          {cameras.length > 1 && (
            <button onClick={toggleCamera} disabled={scanned} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-black rounded-xl text-[10px] uppercase tracking-widest transition-all">
              Switch Camera
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-3 bg-blue-900 hover:bg-blue-800 text-white font-black rounded-xl text-[10px] uppercase tracking-widest transition-all">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;