import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';

export function createDocumentCapabilities() {
  return {
    readPdf: async (path: string) => {
      const buffer = await readFile(path);
      // Dynamic import to avoid loading pdfjs-dist in test environments
      const pdfParse = await import('pdf-parse').then((m) => (m as any).default ?? m);
      const data = await pdfParse(buffer);
      return { text: data.text, pages: data.numpages, info: data.info };
    },
    readDocx: async (path: string) => {
      const result = await mammoth.extractRawText({ path });
      return { text: result.value, styles: [] };
    },
    readXlsx: async (path: string, sheetName?: string) => {
      const workbook = XLSX.readFile(path);
      const sheet = sheetName || workbook.SheetNames[0]!;
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]!, { header: 1 }) as unknown[][];
      return { sheets: workbook.SheetNames, data };
    },
    readPptx: async (path: string) => {
      const zip = new AdmZip(path);
      const entries = zip.getEntries();
      const slideEntries = entries
        .filter((e) => e.entryName.startsWith('ppt/slides/slide') && e.entryName.endsWith('.xml'))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const slides: { text: string; notes: string }[] = [];
      for (const entry of slideEntries) {
        const xml = zip.readAsText(entry);
        const texts: string[] = [];
        const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const match of textMatches) {
          if (match[1]) texts.push(match[1]);
        }
        slides.push({ text: texts.join(' ').trim(), notes: '' });
      }
      return { slides };
    },
  };
}
