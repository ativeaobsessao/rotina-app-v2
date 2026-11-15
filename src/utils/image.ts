export async function compressImage(file: File, maxWidth = 1280): Promise<File> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const needsResize = img.width > maxWidth;
        const targetWidth = needsResize ? maxWidth : img.width;
        const targetHeight = needsResize ? Math.round((img.height * maxWidth) / img.width) : img.height;

        // Se já é JPEG pequeno e menor que 800KB, retorna direto sem reprocessar
        if (!needsResize && file.type === 'image/jpeg' && file.size <= 800 * 1024) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (blob) {
              const safeName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
              resolve(new File([blob], safeName, { type: 'image/jpeg', lastModified: Date.now() }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.85
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
