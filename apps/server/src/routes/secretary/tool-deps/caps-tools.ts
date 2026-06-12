import {
  createDocumentCapabilities,
  createArchiveCapabilities,
  createBrowserCapabilities,
  createCommunicationCapabilities,
  createSystemCapabilities,
} from '../../../capabilities.js';

export function buildCapsTools() {
  const docCaps = createDocumentCapabilities();
  const archiveCaps = createArchiveCapabilities();
  const browserCaps = createBrowserCapabilities();
  const commCaps = createCommunicationCapabilities();
  const sysCaps = createSystemCapabilities();

  return {
    // ── Document capabilities ──
    readPdf: docCaps.readPdf,
    readDocx: docCaps.readDocx,
    readXlsx: docCaps.readXlsx,
    readPptx: docCaps.readPptx,

    // ── Archive capabilities ──
    listZip: archiveCaps.listZip,
    extractZip: archiveCaps.extractZip,

    // ── Browser capabilities ──
    browserNavigate: browserCaps.browserNavigate,
    browserClick: browserCaps.browserClick,
    browserType: browserCaps.browserType,
    browserRead: browserCaps.browserRead,
    browserScreenshot: browserCaps.browserScreenshot,
    browserEvaluate: browserCaps.browserEvaluate,

    // ── Communication capabilities ──
    fetchRss: commCaps.fetchRss,
    sendEmail: commCaps.sendEmail,

    // ── System capabilities ──
    readClipboard: sysCaps.readClipboard,
    writeClipboard: sysCaps.writeClipboard,
    sendNotification: sysCaps.sendNotification,
    startProcess: sysCaps.startProcess,
    killProcess: sysCaps.killProcess,
    showOpenDialog: sysCaps.showOpenDialog,
  };
}
