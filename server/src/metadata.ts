/** Placeholder metadata extractor — will be expanded in future phases */
export async function extractPdfMeta(filePath: string): Promise<{
  title: string;
  author: string;
  pages: number;
  isScanned: boolean;
}> {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const { readFileSync } = await import('fs');
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);

    const text = (data.text || '').trim();
    const isScanned = text.length < 100;

    return {
      title: data.info?.Title || '',
      author: data.info?.Author || '',
      pages: data.numpages || 0,
      isScanned,
    };
  } catch {
    return { title: '', author: '', pages: 0, isScanned: false };
  }
}
