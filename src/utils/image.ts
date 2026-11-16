const ALLOWED_IMAGE_MIME_PREFIX = 'image/';
const UNSUPPORTED_IMAGE_MIMES = new Set(['image/svg+xml']);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;
const MAX_PASSTHROUGH_BYTES = 800 * 1024;
const HEADER_SLICE_BYTES = 128 * 1024;
const DEFAULT_QUALITY = 0.85;

export interface ImageHeaderMetadata {
  format: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
  orientation: number; // EXIF 1..8 (1 = upright)
}

function releaseCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
}

function buildSafeJpgName(originalName: string): string {
  const base = (originalName || 'foto').replace(/\.[^.]+$/, '') || 'foto';
  return `${base}.jpg`;
}

function nextFrameYield(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return Promise.resolve();
}

export function validateImageFile(file: File | Blob | null | undefined, fileName?: string): void {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    throw new Error('O arquivo de imagem está vazio ou inválido.');
  }

  const mime = String((file as File).type || '').toLowerCase().trim();
  const resolvedName = String(fileName || (file as File).name || '').trim();

  if (mime) {
    if (!mime.startsWith(ALLOWED_IMAGE_MIME_PREFIX) || UNSUPPORTED_IMAGE_MIMES.has(mime)) {
      throw new Error('Formato de imagem não suportado. Selecione uma foto JPEG, PNG ou WebP.');
    }
    return;
  }

  // Some Android file pickers omit file.type; validate by filename when available
  if (resolvedName && !SUPPORTED_EXTENSIONS.test(resolvedName)) {
    throw new Error('Formato de arquivo inválido. Selecione uma imagem.');
  }
}

function parseExifOrientation(view: DataView, tiffStart: number, length: number): number {
  if (tiffStart + 8 > length) return 1;
  const byteOrder = view.getUint16(tiffStart, false);
  const littleEndian = byteOrder === 0x4949; // 'II'
  if (!littleEndian && byteOrder !== 0x4d4d) return 1; // 'MM'

  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) return 1;
  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > length) return 1;

  const entries = view.getUint16(ifdStart, littleEndian);
  for (let i = 0; i < entries; i += 1) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > length) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      const orientation = view.getUint16(entryOffset + 8, littleEndian);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

export function parseImageHeaderBytes(buffer: ArrayBuffer): ImageHeaderMetadata | null {
  const len = buffer.byteLength;
  if (len < 12) return null;
  const view = new DataView(buffer);

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR
  if (
    len >= 24 &&
    view.getUint32(0, false) === 0x89504e47 &&
    view.getUint32(4, false) === 0x0d0a1a0a
  ) {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { format: 'png', width, height, orientation: 1 };
    }
  }

  // WebP: RIFF .... WEBP
  if (
    len >= 30 &&
    view.getUint32(0, false) === 0x52494646 &&
    view.getUint32(8, false) === 0x57454250
  ) {
    const chunkTag = view.getUint32(12, false);
    // VP8X (extended)
    if (chunkTag === 0x56503858 && len >= 30) {
      const w = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
      const h = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
      if (w > 0 && h > 0) return { format: 'webp', width: w, height: h, orientation: 1 };
    }
    // VP8 (lossy)
    if (chunkTag === 0x56503820 && len >= 30) {
      const w = view.getUint16(26, true) & 0x3fff;
      const h = view.getUint16(28, true) & 0x3fff;
      if (w > 0 && h > 0) return { format: 'webp', width: w, height: h, orientation: 1 };
    }
    // VP8L (lossless)
    if (chunkTag === 0x5650384c && len >= 25 && view.getUint8(20) === 0x2f) {
      const b0 = view.getUint8(21);
      const b1 = view.getUint8(22);
      const b2 = view.getUint8(23);
      const b3 = view.getUint8(24);
      const w = 1 + (b0 | ((b1 & 0x3f) << 8));
      const h = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
      if (w > 0 && h > 0) return { format: 'webp', width: w, height: h, orientation: 1 };
    }
  }

  // JPEG: FF D8
  if (view.getUint16(0, false) === 0xffd8) {
    let offset = 2;
    let orientation = 1;
    let width = 0;
    let height = 0;

    while (offset + 4 <= len) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2;
        continue;
      }

      if (offset + 4 > len) break;
      const segLength = view.getUint16(offset + 2, false);
      if (segLength < 2) break;

      // APP1 EXIF
      if (marker === 0xe1 && offset + 10 <= len) {
        if (view.getUint32(offset + 4, false) === 0x45786966 && view.getUint16(offset + 8, false) === 0) {
          orientation = parseExifOrientation(
            view,
            offset + 10,
            Math.min(len, offset + 2 + segLength)
          );
        }
      }

      // SOF markers (dimensions)
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 9 <= len) {
        height = view.getUint16(offset + 5, false);
        width = view.getUint16(offset + 7, false);
        break;
      }

      offset += 2 + segLength;
    }

    if (width > 0 && height > 0) {
      return { format: 'jpeg', width, height, orientation };
    }
  }

  return null;
}

export async function inspectImageHeader(file: Blob): Promise<ImageHeaderMetadata | null> {
  try {
    if (typeof file.slice !== 'function') return null;
    const headBuffer = await file.slice(0, HEADER_SLICE_BYTES).arrayBuffer();
    return parseImageHeaderBytes(headBuffer);
  } catch {
    return null;
  }
}

async function decodeWithImageElement(
  file: Blob
): Promise<{ source: HTMLImageElement; width: number; height: number; cleanup: () => void }> {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => {
          URL.revokeObjectURL(objectUrl);
        },
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível ler a imagem selecionada. Tente outra foto.'));
    };
    img.src = objectUrl;
  });
}

async function decodeImageSafely(
  file: Blob,
  maxWidth: number,
  meta: ImageHeaderMetadata | null
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const rawLargest = meta ? Math.max(meta.width, meta.height) : 0;
    const canHintDecodeResize = Boolean(meta && rawLargest > maxWidth);

    if (canHintDecodeResize && meta) {
      const resizeOption: ImageBitmapOptions =
        meta.width >= meta.height
          ? { imageOrientation: 'from-image', resizeWidth: maxWidth, resizeQuality: 'high' }
          : { imageOrientation: 'from-image', resizeHeight: maxWidth, resizeQuality: 'high' };
      try {
        const bitmap = await createImageBitmap(file, resizeOption);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => {
            try {
              bitmap.close();
            } catch {}
          },
        };
      } catch {}
    }

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          try {
            bitmap.close();
          } catch {}
        },
      };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => {
            try {
              bitmap.close();
            } catch {}
          },
        };
      } catch {}
    }
  }

  return decodeWithImageElement(file);
}

export async function compressImage(file: File, maxWidth = 1280): Promise<File> {
  validateImageFile(file);

  const meta = await inspectImageHeader(file);

  // Ultra-fast passthrough ONLY for already-upright, <= maxWidth, small JPEGs
  if (
    meta &&
    meta.format === 'jpeg' &&
    meta.orientation === 1 &&
    Math.max(meta.width, meta.height) <= maxWidth &&
    file.type === 'image/jpeg' &&
    file.size <= MAX_PASSTHROUGH_BYTES
  ) {
    return file;
  }

  let decodeCleanup: (() => void) | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    const decoded = await decodeImageSafely(file, maxWidth, meta);
    decodeCleanup = decoded.cleanup;
    const { source, width, height } = decoded;

    if (!width || !height) {
      throw new Error('A imagem selecionada possui dimensões inválidas.');
    }

    const largestSide = Math.max(width, height);
    const needsResize = largestSide > maxWidth;
    const hasNonNormalOrientation = Boolean(meta && meta.orientation !== 1);

    // If decoder already confirmed <= maxWidth, upright JPEG <= 800KB, passthrough cleanly
    if (
      !needsResize &&
      !hasNonNormalOrientation &&
      file.type === 'image/jpeg' &&
      file.size <= MAX_PASSTHROUGH_BYTES
    ) {
      return file;
    }

    const scale = needsResize ? maxWidth / largestSide : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    await nextFrameYield();

    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível preparar a imagem para envio.');
    }

    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas!.toBlob((b) => resolve(b), 'image/jpeg', DEFAULT_QUALITY);
    });

    if (!blob || blob.size === 0) {
      throw new Error('Falha ao processar a imagem antes do envio.');
    }

    return new File([blob], buildSafeJpgName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    releaseCanvas(canvas);
    try {
      decodeCleanup?.();
    } catch {}
  }
}

export async function captureVideoFrameToJpegFile(
  video: HTMLVideoElement,
  maxWidth = 1280,
  quality = 0.88
): Promise<File> {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw <= 0 || vh <= 0) {
    throw new Error('A câmera ainda está carregando a imagem. Aguarde um instante e tente novamente.');
  }

  const largest = Math.max(vw, vh);
  const scale = largest > maxWidth ? maxWidth / largest : 1;
  const targetWidth = Math.max(1, Math.round(vw * scale));
  const targetHeight = Math.max(1, Math.round(vh * scale));

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível capturar o quadro da câmera.');
    }

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas!.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });

    if (!blob || blob.size === 0) {
      throw new Error('Não foi possível gerar a fotografia capturada.');
    }

    return new File([blob], `camera_${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    releaseCanvas(canvas);
  }
}
