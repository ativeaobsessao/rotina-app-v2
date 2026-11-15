const ALLOWED_IMAGE_MIME_PREFIX = 'image/';
const MAX_PASSTHROUGH_BYTES = 800 * 1024;
const DEFAULT_QUALITY = 0.85;

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

async function decodeWithImageElement(
  file: File
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
      reject(new Error('Não foi possível carregar a imagem selecionada. Tente outra foto.'));
    };
    img.src = objectUrl;
  });
}

export async function compressImage(file: File, maxWidth = 1280): Promise<File> {
  if (!file || typeof file.size !== 'number' || file.size === 0) {
    throw new Error('O arquivo de imagem está vazio ou inválido.');
  }

  if (file.type && !file.type.startsWith(ALLOWED_IMAGE_MIME_PREFIX)) {
    throw new Error('Formato de arquivo inválido. Selecione uma imagem.');
  }

  let bitmap: ImageBitmap | null = null;
  let elementCleanup: (() => void) | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    let source: CanvasImageSource;
    let width = 0;
    let height = 0;

    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } catch {
        const decoded = await decodeWithImageElement(file);
        source = decoded.source;
        width = decoded.width;
        height = decoded.height;
        elementCleanup = decoded.cleanup;
      }
    } else {
      const decoded = await decodeWithImageElement(file);
      source = decoded.source;
      width = decoded.width;
      height = decoded.height;
      elementCleanup = decoded.cleanup;
    }

    if (!width || !height) {
      throw new Error('Dimensões inválidas na imagem selecionada.');
    }

    const largestSide = Math.max(width, height);
    const needsResize = largestSide > maxWidth;

    // Fast path only for valid JPEGs already small enough AND not needing EXIF re-bake risk?
    // If decoded via createImageBitmap from JPEG <= 800KB without resize needed, still keep direct fast path
    // ONLY when file is <= MAX_PASSTHROUGH_BYTES and dimensions fit maxWidth cleanly.
    if (!needsResize && file.type === 'image/jpeg' && file.size <= MAX_PASSTHROUGH_BYTES) {
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
      return file;
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
      bitmap?.close();
    } catch {}
    try {
      elementCleanup?.();
    } catch {}
  }
}
