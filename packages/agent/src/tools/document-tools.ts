import type { ToolDefinition } from '../tool-executor.js';

export interface DocumentToolDeps {
  readPdf: (path: string) => Promise<{
    text: string;
    pages: number;
    info: Record<string, unknown>;
  }>;
  readDocx: (path: string) => Promise<{
    text: string;
    styles: string[];
  }>;
  readXlsx: (
    path: string,
    sheet?: string,
  ) => Promise<{
    sheets: string[];
    data: unknown[][];
  }>;
  readPptx: (path: string) => Promise<{
    slides: { text: string; notes: string }[];
  }>;
}

export function createDocumentTools(deps: DocumentToolDeps): ToolDefinition[] {
  return [
    {
      name: 'read_pdf',
      description:
        'Extract text content from a PDF file. Returns the full text, page count, and metadata.',
      timeoutMs: 60000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the PDF file' },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.readPdf(filePath);
          return {
            path: filePath,
            text: result.text,
            pages: result.pages,
            info: result.info,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'read_docx',
      description: 'Extract text content from a Microsoft Word (.docx) file.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the DOCX file' },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.readDocx(filePath);
          return {
            path: filePath,
            text: result.text,
            styles: result.styles,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'read_xlsx',
      description:
        'Read data from a Microsoft Excel (.xlsx) file. Returns sheet names and cell data as JSON arrays. Specify a sheet name or leave blank for the first sheet.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the XLSX file' },
          sheet: {
            type: 'string',
            description: 'Sheet name to read (default: first sheet)',
          },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const sheet = args.sheet as string | undefined;
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.readXlsx(filePath, sheet);
          return {
            path: filePath,
            sheet: sheet ?? result.sheets[0] ?? null,
            sheets: result.sheets,
            data: result.data,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'read_pptx',
      description:
        'Extract text content from a Microsoft PowerPoint (.pptx) file. Returns text per slide.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the PPTX file' },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.readPptx(filePath);
          return {
            path: filePath,
            slides: result.slides,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
