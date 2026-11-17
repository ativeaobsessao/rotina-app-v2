import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, RotateCcw, Check, X, RefreshCw } from 'lucide-react';
import { captureVideoFrameToJpegFile } from '../../utils/image';
import { Spinner } from '../ui/Spinner';

export interface InAppCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureConfirm: (file: File) => void;
  onFallbackNativeCamera: () => void;
  onFallbackGallery: () => void;
  requestMediaStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  captureFrame?: (video: HTMLVideoElement) => Promise<File>;
}

type CameraErrorKind = 'permission' | 'busy' | 'unavailable' | 'generic' | null;

function classifyCameraError(err: any): { kind: Exclude<CameraErrorKind, null>; message: string } {
  const name = String(err?.name || '');
  const msg = String(err?.message || '').toLowerCase();

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    msg.includes('permission') ||
    msg.includes('denied')
  ) {
    return {
      kind: 'permission',
      message: 'Não foi possível acessar a câmera. Verifique a permissão ou escolha uma foto da galeria.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      kind: 'busy',
      message:
        'A câmera parece estar ocupada por outro aplicativo. Feche o outro app ou use uma alternativa abaixo.',
    };
  }

  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    msg.includes('not supported') ||
    msg.includes('indisponível')
  ) {
    return {
      kind: 'unavailable',
      message:
        'Nenhuma câmera integrada foi encontrada. Você pode usar a câmera do aparelho ou escolher uma foto da galeria.',
    };
  }

  return {
    kind: 'generic',
    message:
      'Não foi possível abrir a câmera integrada. Use a câmera do aparelho ou escolha uma foto da galeria.',
  };
}

export function InAppCameraModal({
  isOpen,
  onClose,
  onCaptureConfirm,
  onFallbackNativeCamera,
  onFallbackGallery,
  requestMediaStream,
  captureFrame,
}: InAppCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const startSeqRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pausedByBackground, setPausedByBackground] = useState(false);

  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);

  const revokeCapturedPreview = useCallback(() => {
    if (previewUrlRef.current) {
      try {
        URL.revokeObjectURL(previewUrlRef.current);
      } catch {}
      previewUrlRef.current = null;
    }
    setCapturedPreviewUrl(null);
    setCapturedFile(null);
  }, []);

  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
      } catch {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    const seq = ++startSeqRef.current;
    stopAllTracks();
    revokeCapturedPreview();
    setCameraError(null);
    setPausedByBackground(false);
    setStarting(true);

    const getStream =
      requestMediaStream ||
      (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
        ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
        : null);

    if (!getStream) {
      if (isMountedRef.current && seq === startSeqRef.current) {
        setStarting(false);
        setCameraError(
          'Câmera integrada indisponível neste navegador. Use a câmera do aparelho ou escolha uma foto da galeria.'
        );
      }
      return;
    }

    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      },
      {
        video: { facingMode: 'environment' },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    let stream: MediaStream | null = null;
    let lastError: any = null;

    for (let i = 0; i < attempts.length; i += 1) {
      try {
        stream = await getStream(attempts[i]);
        break;
      } catch (err: any) {
        lastError = err;
        const errName = String(err?.name || '');
        const shouldRetryRelaxed =
          i < attempts.length - 1 &&
          (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError');
        if (!shouldRetryRelaxed) {
          break;
        }
      }
    }

    if (!isMountedRef.current || seq !== startSeqRef.current) {
      if (stream) {
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      return;
    }

    if (!stream) {
      setStarting(false);
      setCameraError(classifyCameraError(lastError).message);
      return;
    }

    streamRef.current = stream;

    // Try enabling continuous autofocus when hardware/browser exposes capabilities
    try {
      const videoTrack =
        typeof stream.getVideoTracks === 'function'
          ? stream.getVideoTracks()[0]
          : stream.getTracks().find((t) => t.kind === 'video');
      const caps =
        videoTrack && typeof (videoTrack as any).getCapabilities === 'function'
          ? (videoTrack as any).getCapabilities()
          : null;
      if (
        videoTrack &&
        typeof (videoTrack as any).applyConstraints === 'function' &&
        Array.isArray(caps?.focusMode) &&
        caps.focusMode.includes('continuous')
      ) {
        await (videoTrack as any)
          .applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          .catch(() => {});
      }
    } catch {}

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = stream;
        if (typeof videoRef.current.play === 'function') {
          await videoRef.current.play().catch(() => {});
        }
      } catch {}
    }

    setStarting(false);
    setCameraReady(true);
  }, [requestMediaStream, revokeCapturedPreview, stopAllTracks]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      startSeqRef.current += 1;
      stopAllTracks();
      revokeCapturedPreview();
    };
  }, [revokeCapturedPreview, stopAllTracks]);

  useEffect(() => {
    if (!isOpen) {
      startSeqRef.current += 1;
      stopAllTracks();
      revokeCapturedPreview();
      setCameraError(null);
      setPausedByBackground(false);
      return;
    }

    startCamera();

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        startSeqRef.current += 1;
        stopAllTracks();
        if (isMountedRef.current && !previewUrlRef.current) {
          setPausedByBackground(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, revokeCapturedPreview, startCamera, stopAllTracks]);

  const handleCapture = async () => {
    if (capturing || starting || !videoRef.current) return;
    setCapturing(true);
    setCameraError(null);

    try {
      let file: File | null = null;

      if (captureFrame) {
        file = await captureFrame(videoRef.current);
      } else {
        // Prefer ImageCapture.takePhoto() (full hardware sensor resolution on Chrome Android)
        const ImageCaptureCtor = (globalThis as any).ImageCapture;
        const stream = streamRef.current;
        const videoTrack = stream
          ? typeof stream.getVideoTracks === 'function'
            ? stream.getVideoTracks()[0]
            : stream.getTracks().find((t) => t.kind === 'video')
          : null;

        if (typeof ImageCaptureCtor === 'function' && videoTrack) {
          try {
            const capturer = new ImageCaptureCtor(videoTrack);
            let photoSettings: Record<string, any> | undefined;
            if (typeof capturer.getPhotoCapabilities === 'function') {
              const caps = await capturer.getPhotoCapabilities().catch(() => null);
              if (caps?.imageWidth?.max && caps?.imageHeight?.max) {
                photoSettings = {
                  imageWidth: caps.imageWidth.max,
                  imageHeight: caps.imageHeight.max,
                };
              }
            }
            const photoBlob: Blob = await capturer.takePhoto(photoSettings);
            if (photoBlob && photoBlob.size > 0) {
              file = new File([photoBlob], `camera_${Date.now()}.jpg`, {
                type: photoBlob.type || 'image/jpeg',
                lastModified: Date.now(),
              });
            }
          } catch {
            // Fall back to high-res video frame capture if takePhoto() fails
          }
        }

        if (!file) {
          file = await captureVideoFrameToJpegFile(videoRef.current, 2048, 0.92);
        }
      }

      if (!isMountedRef.current) return;

      // Release hardware camera immediately while reviewing the captured photo
      stopAllTracks();

      const previewUrl = URL.createObjectURL(file);
      if (previewUrlRef.current) {
        try {
          URL.revokeObjectURL(previewUrlRef.current);
        } catch {}
      }
      previewUrlRef.current = previewUrl;
      setCapturedFile(file);
      setCapturedPreviewUrl(previewUrl);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setCameraError(
        err?.message || 'Não foi possível capturar a fotografia. Tente novamente.'
      );
    } finally {
      if (isMountedRef.current) {
        setCapturing(false);
      }
    }
  };

  const handleDiscard = () => {
    revokeCapturedPreview();
    startCamera();
  };

  const handleConfirm = () => {
    if (!capturedFile) return;
    const confirmedFile = capturedFile;
    stopAllTracks();
    revokeCapturedPreview();
    onCaptureConfirm(confirmedFile);
  };

  const handleCloseCamera = () => {
    startSeqRef.current += 1;
    stopAllTracks();
    revokeCapturedPreview();
    onClose();
  };

  const handleUseNativeCamera = () => {
    startSeqRef.current += 1;
    stopAllTracks();
    revokeCapturedPreview();
    onFallbackNativeCamera();
  };

  const handleUseGallery = () => {
    startSeqRef.current += 1;
    stopAllTracks();
    revokeCapturedPreview();
    onFallbackGallery();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Câmera da refeição"
      className="fixed inset-0 z-[150] bg-black text-white flex flex-col pt-safe pb-safe"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-b from-black/80 to-transparent z-10">
        <button
          type="button"
          onClick={handleCloseCamera}
          aria-label="Fechar câmera"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <span className="text-sm font-semibold tracking-tight truncate">
          {capturedPreviewUrl ? 'Conferir foto' : 'Foto da refeição'}
        </span>

        {!capturedPreviewUrl ? (
          <button
            type="button"
            onClick={handleUseNativeCamera}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            Câmera do aparelho
          </button>
        ) : (
          <div className="w-[44px]" aria-hidden="true" />
        )}
      </div>

      {/* Viewfinder / Preview / Error Area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-zinc-950">
        {capturedPreviewUrl ? (
          <img
            src={capturedPreviewUrl}
            alt="Prévia da foto capturada"
            className="w-full h-full object-contain"
          />
        ) : cameraError ? (
          <div className="px-6 py-8 max-w-sm w-full text-center space-y-5">
            <div className="w-14 h-14 mx-auto rounded-full bg-white/10 flex items-center justify-center">
              <Camera className="w-7 h-7 text-zinc-300" />
            </div>
            <p className="text-sm text-zinc-200 leading-relaxed">{cameraError}</p>
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleUseNativeCamera}
                className="w-full min-h-[46px] px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Usar câmera do aparelho</span>
              </button>
              <button
                type="button"
                onClick={handleUseGallery}
                className="w-full min-h-[46px] px-4 py-3 rounded-2xl bg-white/12 hover:bg-white/20 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <ImageIcon className="w-4 h-4 shrink-0" />
                <span>Escolher da galeria</span>
              </button>
              <button
                type="button"
                onClick={() => startCamera()}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-zinc-300 hover:text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tentar câmera integrada novamente</span>
              </button>
            </div>
          </div>
        ) : pausedByBackground ? (
          <div className="px-6 py-8 max-w-sm w-full text-center space-y-4">
            <p className="text-sm text-zinc-200">
              A câmera foi pausada enquanto você saiu do aplicativo.
            </p>
            <button
              type="button"
              onClick={() => startCamera()}
              className="min-h-[46px] px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4" />
              <span>Reabrir câmera</span>
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {starting && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
                <Spinner className="w-7 h-7 text-white" />
                <span className="text-xs text-zinc-300 font-medium">Abrindo câmera...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Thumb-Zone Controls */}
      <div className="px-5 py-5 bg-gradient-to-t from-black/90 via-black/75 to-transparent">
        {capturedPreviewUrl ? (
          <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleDiscard}
              className="min-h-[48px] px-4 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Tirar outra</span>
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="min-h-[48px] px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>Usar esta foto</span>
            </button>
          </div>
        ) : !cameraError && !pausedByBackground ? (
          <div className="max-w-md mx-auto flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleUseGallery}
              aria-label="Escolher da galeria"
              className="min-w-[48px] min-h-[48px] px-3 rounded-2xl bg-white/12 hover:bg-white/20 text-white text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            >
              <ImageIcon className="w-5 h-5" />
              <span>Galeria</span>
            </button>

            <button
              type="button"
              onClick={handleCapture}
              disabled={!cameraReady || starting || capturing}
              aria-label="Capturar foto"
              className="w-18 h-18 rounded-full border-4 border-white bg-white/90 hover:bg-white disabled:opacity-40 flex items-center justify-center active:scale-90 transition-all shadow-xl"
            >
              <span className="w-14 h-14 rounded-full bg-white border-2 border-black/15 block" />
            </button>

            <div className="w-[82px]" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
