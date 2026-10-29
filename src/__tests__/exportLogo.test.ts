/** @jest-environment jsdom */
import {
  LOGO_MAX_FILE_BYTES,
  LOGO_MAX_SIDE,
  LogoRefusal,
  checkLogoFile,
  fitWithin,
  imageDimensions,
  prepareLogo,
} from '../renderer/exports/logo';

/** A minimal valid PNG header of the given size, as a data URL. */
const pngOf = (width: number, height: number): string => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
};

/** A JPEG with an APP0 segment, then a SOF0 frame of the given size. */
const jpegOf = (width: number, height: number): string => {
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
};

describe('checkLogoFile', () => {
  it('accepts PNG and JPEG pictures', () => {
    expect(checkLogoFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkLogoFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
  });

  it('refuses other types with a plain message (the type, not the name)', () => {
    expect(checkLogoFile({ type: 'image/svg+xml', size: 10 })).toMatch(
      /PNG or JPEG/,
    );
    expect(checkLogoFile({ type: 'application/pdf', size: 10 })).toMatch(
      /PNG or JPEG/,
    );
    expect(checkLogoFile({ type: '', size: 10 })).toMatch(/PNG or JPEG/);
  });

  it('refuses a file over 5 MB, and an empty one', () => {
    expect(
      checkLogoFile({ type: 'image/png', size: LOGO_MAX_FILE_BYTES + 1 }),
    ).toMatch(/5 MB/);
    expect(
      checkLogoFile({ type: 'image/png', size: LOGO_MAX_FILE_BYTES }),
    ).toBeNull();
    expect(checkLogoFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('fitWithin', () => {
  it('shrinks the long side to the limit and keeps the shape', () => {
    expect(fitWithin(3000, 1500)).toEqual({
      width: LOGO_MAX_SIDE,
      height: 300,
    });
    expect(fitWithin(1200, 4800)).toEqual({
      width: 150,
      height: LOGO_MAX_SIDE,
    });
  });

  it('never enlarges a small picture, and never makes a side 0', () => {
    expect(fitWithin(200, 100)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(10000, 1)).toEqual({ width: LOGO_MAX_SIDE, height: 1 });
  });
});

describe('imageDimensions', () => {
  it('reads PNG and JPEG sizes from the header', () => {
    expect(imageDimensions(pngOf(420, 160))).toEqual({
      width: 420,
      height: 160,
    });
    expect(imageDimensions(jpegOf(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('returns null for anything else', () => {
    expect(imageDimensions('')).toBeNull();
    expect(imageDimensions('data:image/gif;base64,R0lGOD')).toBeNull();
    expect(imageDimensions('data:image/png;base64,@@@')).toBeNull();
    expect(imageDimensions('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('prepareLogo (canvas mocked)', () => {
  const originalImage = global.Image;
  const drawn: Array<[number, number]> = [];
  let toDataURL: jest.Mock;
  let fillRect: jest.Mock;

  const install = (
    naturalWidth: number,
    naturalHeight: number,
    loads = true,
  ) => {
    class FakeImage {
      naturalWidth = naturalWidth;

      naturalHeight = naturalHeight;

      onload: (() => void) | null = null;

      onerror: (() => void) | null = null;

      set src(_value: string) {
        setTimeout(() => (loads ? this.onload?.() : this.onerror?.()), 0);
      }
    }
    // @ts-expect-error a minimal stand-in for the browser's Image
    global.Image = FakeImage;
  };

  beforeEach(() => {
    drawn.length = 0;
    toDataURL = jest.fn(() => 'data:image/png;base64,SHRUNK');
    fillRect = jest.fn();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          fillRect,
          drawImage: (
            _image: unknown,
            _x: number,
            _y: number,
            w: number,
            h: number,
          ) => drawn.push([w, h]),
        }) as unknown as CanvasRenderingContext2D,
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation((...args: unknown[]) => toDataURL(...args));
  });

  afterEach(() => {
    global.Image = originalImage;
    jest.restoreAllMocks();
  });

  const file = (type: string, size = 100) =>
    new File([new Uint8Array(size)], 'logo', { type });

  it('shrinks a big picture to 600 px on its long side and returns the data URL', async () => {
    install(2400, 1200);
    await expect(prepareLogo(file('image/png'))).resolves.toBe(
      'data:image/png;base64,SHRUNK',
    );
    expect(drawn).toEqual([[600, 300]]);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(fillRect).not.toHaveBeenCalled(); // transparency is kept
  });

  it('keeps a JPEG a JPEG, on a white background', async () => {
    install(800, 800);
    toDataURL.mockReturnValue('data:image/jpeg;base64,SHRUNK');
    await prepareLogo(file('image/jpeg'));
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    expect(fillRect).toHaveBeenCalled();
  });

  it('refuses a wrong type or a huge file before reading it', async () => {
    install(10, 10);
    await expect(prepareLogo(file('image/gif'))).rejects.toBeInstanceOf(
      LogoRefusal,
    );
    await expect(
      prepareLogo(file('image/png', LOGO_MAX_FILE_BYTES + 1)),
    ).rejects.toThrow(/5 MB/);
    expect(drawn).toEqual([]);
  });

  it('refuses a file that is not really a picture', async () => {
    install(0, 0, false);
    await expect(prepareLogo(file('image/png'))).rejects.toThrow(
      /not a picture/,
    );
  });
});
