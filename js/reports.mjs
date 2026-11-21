function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCsv(rows) {
  const content = rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(';')).join('\r\n');
  download('\uFEFF' + content, 'text/csv;charset=utf-8', 'informe-horas-cgt.csv');
}

const encoder = new TextEncoder();
const byteLength = value => encoder.encode(value).length;
function pdfText(value) {
  return [...value.replace(/[−—]/g, '-')].map(character => {
    const code = character.charCodeAt(0);
    if (code > 255 || code < 32) return '?';
    if (code > 126 || /[()\\]/.test(character)) return '\\' + code.toString(8).padStart(3, '0');
    return character;
  }).join('');
}
export function buildPdf(lines) {
  const wrapped = lines.flatMap(line => line.match(/.{1,92}(?:\s|$)|.{1,92}/g) || ['']);
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const pages = [];
  for (let index = 0; index < wrapped.length; index += 48) {
    const page = objects.length + 1;
    pages.push(page + ' 0 R');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>');
    const stream = 'BT /F1 11 Tf 15 TL 42 794 Td\n' +
      wrapped.slice(index, index + 48).map(line => '(' + pdfText(line) + ') Tj T*').join('\n') + '\nET\n';
    objects.push('<< /Length ' + byteLength(stream) + ' >>\nstream\n' + stream + 'endstream');
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.join(' ') + '] >>';
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(byteLength(output));
    output += (index + 1) + ' 0 obj\n' + value + '\nendobj\n';
  });
  const xref = byteLength(output);
  return output + 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' +
    offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
}
export function exportPdf(lines) {
  download(buildPdf(lines), 'application/pdf', 'informe-horas-cgt.pdf');
}
