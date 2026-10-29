/**
 * The event logo shown in every exported document: choosing a file, checking
 * it, shrinking it, and reading its size back from the data URL.
 *
 * The logo is stored with the event as a data URL (Events.export_logo), so it
 * is shrunk to at most LOGO_MAX_SIDE pixels on its long side before it is
 * saved: a camera photo of 6 MB would otherwise be copied into every backup.
 */

/** Longest side of a stored logo, in pixels. */
export const LOGO_MAX_SIDE = 600;
/** A file larger than this is refused before it is even read. */
export const LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];

export class LogoRefusal extends Error {}

export interface LogoFile {
  size: number;
  type: string;
}

/**
 * Whether a chosen file can be the logo; the reason in plain words when not.
 * The type is checked from the file itself, never from its name.
 */
export const checkLogoFile = (file: LogoFile): string | null => {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'The logo must be a PNG or JPEG picture. Choose a .png or .jpg file.';
  }
  if (file.size > LOGO_MAX_FILE_BYTES) {
    return 'That picture is larger than 5 MB. Choose a smaller file, or shrink it first.';
  }
  if (file.size === 0) {
    return 'That file is empty. Choose a different picture.';
  }
  return null;
};

/** The size a picture is shrunk to: long side at most `maxSide`, never enlarged. */
export const fitWithin = (
  width: number,
  height: number,
  maxSide: number = LOGO_MAX_SIDE,
): { width: number; height: number } => {
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const scale = maxSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new LogoRefusal('That file is not a picture the app can read.'));
    image.src = url;
  });

/**
 * Check a file, shrink it with a canvas and return the data URL to store. A
 * transparent PNG stays a PNG (a logo often has no background); a JPEG stays a
 * JPEG. Throws LogoRefusal with a plain message when the file cannot be used.
 */
export const prepareLogo = async (file: File): Promise<string> => {
  const refusal = checkLogoFile(file);
  if (refusal) throw new LogoRefusal(refusal);

  const image = await loadImage(await readAsDataUrl(file));
  const { width, height } = fitWithin(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  if (width < 1 || height < 1) {
    throw new LogoRefusal('That picture has no size. Choose a different file.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new LogoRefusal(
      'The picture could not be prepared on this computer.',
    );
  }
  const isPng = file.type === 'image/png';
  if (!isPng) {
    // A JPEG has no transparency: paint white under it, never black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const url = isPng
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.9);
  if (!/^data:image\/(png|jpeg);base64,/.test(url)) {
    throw new LogoRefusal(
      'The picture could not be prepared on this computer.',
    );
  }
  return url;
};

const decodeBase64 = (dataUrl: string): Uint8Array | null => {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const readUint = (bytes: Uint8Array, at: number, length: number): number => {
  let value = 0;
  for (let i = 0; i < length; i += 1)
    value = value * 256 + (bytes[at + i] ?? 0);
  return value;
};

/**
 * Width and height of a PNG or JPEG data URL, read from the file header (the
 * Excel export needs the size to place the picture without stretching it).
 * null when the data is not a picture this reader understands.
 */
export const imageDimensions = (
  dataUrl: string,
): { width: number; height: number } | null => {
  const bytes = decodeBase64(dataUrl);
  if (!bytes) return null;

  // PNG: 8-byte signature, then IHDR with width and height at bytes 16 and 20.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: readUint(bytes, 16, 4), height: readUint(bytes, 20, 4) };
  }

  // JPEG: walk the marker segments to the first Start Of Frame.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
      } else {
        const marker = bytes[at + 1];
        const isFrame =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isFrame) {
          return {
            height: readUint(bytes, at + 5, 2),
            width: readUint(bytes, at + 7, 2),
          };
        }
        at += 2 + readUint(bytes, at + 2, 2);
      }
    }
  }
  return null;
};
