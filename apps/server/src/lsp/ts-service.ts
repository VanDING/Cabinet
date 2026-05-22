import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

interface TSServiceResult {
  available: boolean;
  error?: string;
}

interface SymbolResult extends TSServiceResult {
  symbols?: { name: string; kind: string; file: string; line: number; column: number }[];
}

interface ReferenceResult extends TSServiceResult {
  references?: { file: string; line: number; column: number; lineText: string }[];
}

interface DiagnosticResult extends TSServiceResult {
  diagnostics?: { file: string; line: number; column: number; message: string; category: 'error' | 'warning' | 'suggestion' }[];
}

let tsModule: any = null;
let tsService: any = null;
let projectRoot = '';

function resolveTSPackage(): string | null {
  try {
    return require.resolve('typescript', { paths: [process.cwd()] });
  } catch {
    try {
      return require.resolve('typescript');
    } catch {
      return null;
    }
  }
}

function findTSConfig(): string | null {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'tsconfig.json'),
    join(cwd, 'jsconfig.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function initTSService(): TSServiceResult {
  if (tsService) return { available: true };

  const tsPath = resolveTSPackage();
  if (!tsPath) return { available: false, error: 'TypeScript not found in project. Install typescript as a dev dependency.' };

  const tsconfigPath = findTSConfig();
  if (!tsconfigPath) return { available: false, error: 'No tsconfig.json or jsconfig.json found in project root.' };

  try {
    tsModule = require(tsPath);
    projectRoot = dirname(tsconfigPath);

    const configFile = tsModule.readConfigFile(tsconfigPath, tsModule.sys.readFile);
    if (configFile.error) {
      return { available: false, error: tsModule.flattenDiagnosticMessageText(configFile.error.messageText, '\n') };
    }

    const parsed = tsModule.parseJsonConfigFileContent(
      configFile.config,
      tsModule.sys,
      projectRoot,
    );
    const rootFiles = parsed.fileNames;
    const compilerOptions = parsed.options;

    const host = tsModule.createCompilerHost(compilerOptions);
    const originalGetScriptFileNames = host.getScriptFileNames;
    let trackedFiles: string[] = [...rootFiles];

    const documentRegistry = tsModule.createDocumentRegistry();
    tsService = tsModule.createLanguageService(
      {
        getScriptFileNames: () => trackedFiles,
        getScriptVersion: () => '0',
        getScriptSnapshot: (fileName: string) => {
          try {
            const content = readFileSync(fileName, 'utf-8');
            return tsModule.ScriptSnapshot.fromString(content);
          } catch {
            return undefined;
          }
        },
        getCurrentDirectory: () => projectRoot,
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: (options: any) => tsModule.getDefaultLibFilePath(options),
        fileExists: (fileName: string) => existsSync(fileName),
        readFile: (fileName: string) => {
          try { return readFileSync(fileName, 'utf-8'); } catch { return undefined; }
        },
        readDirectory: tsModule.sys.readDirectory,
        directoryExists: tsModule.sys.directoryExists,
        getDirectories: tsModule.sys.getDirectories,
      },
      documentRegistry,
    );

    return { available: true };
  } catch (e) {
    return { available: false, error: `Failed to initialize TypeScript service: ${(e as Error).message}` };
  }
}

export function getWorkspaceSymbols(query: string): SymbolResult {
  const init = initTSService();
  if (!init.available || !tsService) return init;

  try {
    const items = tsService.getNavigateToItems(query, 30, undefined, undefined, undefined);
    const symbols = items.map((item: any) => ({
      name: item.name,
      kind: item.kind,
      file: item.fileName,
      line: item.textSpan ? tsModule.getLineAndCharacterOfPosition(
        tsService.getProgram()?.getSourceFile(item.fileName),
        item.textSpan.start,
      ).line + 1 : 0,
      column: item.textSpan ? tsModule.getLineAndCharacterOfPosition(
        tsService.getProgram()?.getSourceFile(item.fileName),
        item.textSpan.start,
      ).character + 1 : 0,
    }));
    return { available: true, symbols };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  }
}

function getPosition(fileName: string, line: number, column: number): number {
  try {
    const source = tsService?.getProgram()?.getSourceFile(fileName);
    if (!source) return 0;
    return tsModule.getPositionOfLineAndCharacter(source, line - 1, column - 1);
  } catch {
    return 0;
  }
}

export function getDefinition(fileName: string, line: number, column: number): SymbolResult {
  const init = initTSService();
  if (!init.available || !tsService) return init;

  try {
    const pos = getPosition(fileName, line, column);
    const defs = tsService.getDefinitionAtPosition(fileName, pos);
    if (!defs || defs.length === 0) return { available: true, symbols: [] };

    const symbols = defs.map((d: any) => {
      const sf = tsService.getProgram()?.getSourceFile(d.fileName);
      const lc = sf ? tsModule.getLineAndCharacterOfPosition(sf, d.textSpan.start) : { line: 0, character: 0 };
      return {
        name: d.fileName,
        kind: 'definition',
        file: d.fileName,
        line: lc.line + 1,
        column: lc.character + 1,
      };
    });
    return { available: true, symbols };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  }
}

export function getReferences(fileName: string, line: number, column: number): ReferenceResult {
  const init = initTSService();
  if (!init.available || !tsService) return init;

  try {
    const pos = getPosition(fileName, line, column);
    const refs = tsService.getReferencesAtPosition(fileName, pos);
    if (!refs || refs.length === 0) return { available: true, references: [] };

    const references = refs.slice(0, 50).map((r: any) => {
      const sf = tsService.getProgram()?.getSourceFile(r.fileName);
      const lc = sf ? tsModule.getLineAndCharacterOfPosition(sf, r.textSpan.start) : { line: 0, character: 0 };
      const lineStart = sf ? tsModule.getPositionOfLineAndCharacter(sf, lc.line, 0) : 0;
      const lineEnd = sf ? sf.text.indexOf('\n', lineStart) : -1;
      const lineText = sf ? sf.text.slice(lineStart, lineEnd === -1 ? sf.text.length : lineEnd).trim() : '';
      return {
        file: r.fileName,
        line: lc.line + 1,
        column: lc.character + 1,
        lineText: lineText.slice(0, 200),
      };
    });
    return { available: true, references };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  }
}

export function getDiagnostics(fileName?: string): DiagnosticResult {
  const init = initTSService();
  if (!init.available || !tsService) return init;

  try {
    if (fileName) {
      const syntactic = tsService.getSyntacticDiagnostics(fileName);
      const semantic = tsService.getSemanticDiagnostics(fileName);
      const suggestion = tsService.getSuggestionDiagnostics(fileName);
      const all = [...syntactic, ...semantic, ...suggestion];
      const diagnostics = all.slice(0, 50).map((d: any) => {
        const sf = tsService.getProgram()?.getSourceFile(d.file?.fileName ?? fileName);
        const lc = sf ? tsModule.getLineAndCharacterOfPosition(sf, d.start ?? 0) : { line: 0, character: 0 };
        return {
          file: d.file?.fileName ?? fileName,
          line: lc.line + 1,
          column: lc.character + 1,
          message: tsModule.flattenDiagnosticMessageText(d.messageText, '\n'),
          category: d.category === tsModule.DiagnosticCategory.Error ? 'error' as const
            : d.category === tsModule.DiagnosticCategory.Warning ? 'warning' as const
            : 'suggestion' as const,
        };
      });
      return { available: true, diagnostics };
    }

    // All files — get all semantic diagnostics
    const program = tsService.getProgram();
    const diagnostics: any[] = [];
    for (const sf of program.getSourceFiles()) {
      if (sf.fileName.includes('node_modules')) continue;
      const syntactic = tsService.getSyntacticDiagnostics(sf.fileName);
      const semantic = tsService.getSemanticDiagnostics(sf.fileName);
      const all = [...syntactic, ...semantic];
      for (const d of all.slice(0, 10)) {
        const lc = tsModule.getLineAndCharacterOfPosition(sf, d.start ?? 0);
        diagnostics.push({
          file: sf.fileName,
          line: lc.line + 1,
          column: lc.character + 1,
          message: tsModule.flattenDiagnosticMessageText(d.messageText, '\n'),
          category: d.category === tsModule.DiagnosticCategory.Error ? 'error' as const : 'warning' as const,
        });
      }
    }
    return { available: true, diagnostics: diagnostics.slice(0, 100) };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  }
}

/** Force re-sync from disk after file edits. */
export function refreshTSService(): void {
  tsService = null;
  tsModule = null;
  projectRoot = '';
}
