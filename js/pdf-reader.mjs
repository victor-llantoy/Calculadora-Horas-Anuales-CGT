import { formatDate } from './calculator.mjs?v=horas-2026';
import { parsePage, startDate } from './rota-parser.mjs?v=horas-2026';

export async function readRotas(files, name, signal, progress) {
  const pdf = await import('../vendor/pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
  const documents = [], warnings = [];
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const number = index + 1;
    progress(number);
    let task;
    const cancel = () => { task?.destroy().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const bytes = await file.arrayBuffer();
      signal.throwIfAborted();
      task = pdf.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
        verbosity: 0, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true });
      const doc = await task.promise;
      const pages = [];
      for (let index = 1; index <= doc.numPages; index++) {
        signal.throwIfAborted();
        const page = await doc.getPage(index);
        try { pages.push((await page.getTextContent()).items); }
        finally { page.cleanup(); }
      }
      const start = startDate(file.name, pages);
      if (!start) { warnings.push('Documento ' + number + ': fecha semanal ausente o contradictoria.'); continue; }
      const parsed = pages.map(page => parsePage(page, name, start));
      const matching = parsed.filter(result => result.matched);
      if (matching.length !== 1 || parsed.some(result => result.ambiguous)) {
        warnings.push('Documento ' + number + ': no se encontró una fila personal inequívoca.');
        continue;
      }
      const [{ records, issues }] = matching;
      if (issues.length) warnings.push('Documento ' + number + ': revisar ' + issues.map(formatDate).join(', ') + '.');
      documents.push({ start, number, records, issues });
    } catch {
      signal.throwIfAborted();
      warnings.push('Documento ' + number + ': PDF ilegible o incompatible.');
    } finally {
      signal.removeEventListener('abort', cancel);
      await task?.destroy().catch(() => {});
    }
  }
  return { documents, warnings };
}
