'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, SwitchCamera, X, Check, Upload, RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onFileSelect?: (file: File) => void;
  facingMode?: 'user' | 'environment';
  className?: string;
  label?: string;
  description?: string;
  previewUrl?: string | null;
  accept?: string;
}

export function CameraCapture({
  onCapture,
  onFileSelect,
  facingMode: initialFacingMode = 'user',
  className,
  label = 'Foto',
  description,
  previewUrl,
  accept = 'image/*',
}: CameraCaptureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(initialFacingMode);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Check for multiple cameras
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setHasMultipleCameras(videoDevices.length > 1);
    }).catch(() => {});
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
  }, []);

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    try {
      setError(null);
      setIsLoading(true);
      setIsCameraReady(false);
      
      // Stop any existing stream first
      stopCamera();

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Wait for video to be ready
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            setIsCameraReady(true);
            setIsLoading(false);
          }).catch((e) => {
            console.error('Error playing video:', e);
            setIsLoading(false);
          });
        };
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('No se pudo acceder a la cámara. Verifica los permisos del navegador.');
      setIsLoading(false);
    }
  }, [stopCamera]);

  // Start camera when dialog opens
  useEffect(() => {
    if (isOpen && !capturedImage) {
      startCamera(facingMode);
    }
    return () => {
      if (!isOpen) {
        stopCamera();
      }
    };
  }, [isOpen, facingMode, capturedImage, startCamera, stopCamera]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      stopCamera();
      setCapturedImage(null);
      setError(null);
      setIsCameraReady(false);
    }
  };

  const switchCamera = () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current || !isCameraReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    
    ctx.drawImage(video, 0, 0);
    
    const imageUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedImage(imageUrl);
    stopCamera();
  };

  const retakePhoto = () => {
    setCapturedImage(null);
    // startCamera will be called by the useEffect when capturedImage becomes null
  };

  const confirmPhoto = () => {
    if (!capturedImage) return;

    // Convert data URL to File
    fetch(capturedImage)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
        setIsOpen(false);
        setCapturedImage(null);
      });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (onFileSelect) {
        onFileSelect(file);
      } else {
        onCapture(file);
      }
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsOpen(true)}
          className="flex-1 gap-2"
        >
          <Camera className="h-4 w-4" />
          Tomar foto
        </Button>
        
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 gap-2"
        >
          <Upload className="h-4 w-4" />
          Subir archivo
        </Button>
        
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Posiciona tu rostro en el centro y toma la foto
            </DialogDescription>
          </DialogHeader>

          <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
            {error ? (
              <div className="absolute inset-0 flex items-center justify-center text-white text-center p-4">
                <p>{error}</p>
              </div>
            ) : capturedImage ? (
              <img
                src={capturedImage}
                alt="Foto capturada"
                className="w-full h-full object-cover"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn(
                    "w-full h-full object-cover",
                    facingMode === 'user' && "scale-x-[-1]"
                  )}
                />
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
              </>
            )}
            
            {/* Camera guide overlay */}
            {!capturedImage && !error && isCameraReady && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-white/50 rounded-full" />
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          <div className="flex justify-center gap-3">
            {capturedImage ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={retakePhoto}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Repetir
                </Button>
                <Button
                  type="button"
                  onClick={confirmPhoto}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" />
                  Usar foto
                </Button>
              </>
            ) : (
              <>
                {hasMultipleCameras && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={switchCamera}
                    disabled={!!error || isLoading}
                  >
                    <SwitchCamera className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="lg"
                  onClick={capturePhoto}
                  disabled={!!error || !isCameraReady || isLoading}
                  className="rounded-full w-16 h-16"
                >
                  <Camera className="h-6 w-6" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
