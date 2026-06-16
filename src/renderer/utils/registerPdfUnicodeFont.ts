import type { jsPDF } from 'jspdf';
import dejavuSansRegularTtf from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf';
import dejavuSansBoldTtf from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf';

interface FontData {
  regular: string;
  bold: string;
}

let cachedFontDataPromise: Promise<FontData> | null = null;

const arrayBufferToBase64 = (arrayBuffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const loadFontAsBase64 = async (fontUrl: string): Promise<string> => {
  const response = await fetch(fontUrl);
  if (!response.ok) {
    throw new Error(`Could not load PDF font: ${fontUrl}`);
  }

  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
};

const getFontData = async (): Promise<FontData> => {
  if (!cachedFontDataPromise) {
    cachedFontDataPromise = Promise.all([
      loadFontAsBase64(dejavuSansRegularTtf),
      loadFontAsBase64(dejavuSansBoldTtf),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }

  return cachedFontDataPromise;
};

const hasFontStyle = (doc: jsPDF, fontName: string, style: string): boolean => {
  const fontList: Record<string, string[]> = doc.getFontList?.() || {};
  const styles = fontList[fontName];
  return Array.isArray(styles) && styles.includes(style);
};

export default async function registerPdfUnicodeFont(
  doc: jsPDF,
): Promise<void> {
  if (!doc) {
    return;
  }

  const { regular, bold } = await getFontData();

  if (!hasFontStyle(doc, 'DejaVuSans', 'normal')) {
    doc.addFileToVFS('DejaVuSans.ttf', regular);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  }

  if (!hasFontStyle(doc, 'DejaVuSans', 'bold')) {
    doc.addFileToVFS('DejaVuSans-Bold.ttf', bold);
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  }

  doc.setFont('DejaVuSans', 'normal');
}
