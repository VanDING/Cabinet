import AdmZip from 'adm-zip';

export function createArchiveCapabilities() {
  return {
    listZip: async (path: string) => {
      const zip = new AdmZip(path);
      return zip.getEntries().map((e) => ({
        name: e.entryName,
        size: e.header.size,
        isDirectory: e.isDirectory,
      }));
    },
    extractZip: async (path: string, targetDir: string, entries?: string[]) => {
      const zip = new AdmZip(path);
      zip.extractAllTo(targetDir, true);
      return { extracted: entries ?? zip.getEntries().map((e) => e.entryName) };
    },
  };
}
