/** Скачивание файлов: SVG приходит с сервера, PNG растеризуется в браузере. */

export function triggerDownload(url: string, fileName?: string): void {
  const link = document.createElement('a');
  link.href = url;
  if (fileName) link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface PngOptions {
  fileName: string;
  /** Множитель к собственному размеру SVG. */
  scale?: number;
  /** Цвет подложки — PNG с прозрачным фоном плохо выглядит в документах. */
  background: string;
}

/** Растеризует готовый SVG-документ в PNG и отдаёт файл пользователю. */
export async function downloadSvgAsPng(svgText: string, options: PngOptions): Promise<void> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Не удалось отрисовать схему'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await loaded;

  const scale = options.scale ?? 2;
  const width = Math.round((image.naturalWidth || 900) * scale);
  const height = Math.round((image.naturalHeight || 943) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает canvas');

  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не удалось сохранить PNG');
  downloadBlob(blob, options.fileName);
}
