import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { add } from '../js/calculator.mjs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const types = { html: 'text/html', mjs: 'text/javascript', css: 'text/css' };
const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/Calculadora-Horas-Anuales-CGT\//, '');
  try {
    const file = path || 'index.html';
    const body = await readFile(new URL(file, root));
    response.writeHead(200, { 'Content-Type': types[file.split('.').at(-1)] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});

function fixture(name, start, shift = '17:00', day = 0, guaranteed = false) {
  const cell = (p, x, y) => 'BT /F1 10 Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + p + ') Tj ET\n';
  const columns = [215,259,304,348,393,437,482,526,570,614,660,704,748,792];
  const format = date => date.split('-').reverse().join('/');
  const stream = cell(format(start) + ' al ' + format(add(start, 6)), 22, 540) +
    cell('Persona Sintetica', 20, 420) + cell('09:00', columns[day*2], 420) + cell(shift, columns[day*2+1], 420) +
    cell('V', columns[((day+1)%7)*2], 420) + (guaranteed ? cell('G', columns[10], 420) : '') + cell('EMPLEADO AJENO', 20, 390) +
    cell('08:00', 215, 390) + cell('18:00',259,390);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream'];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += (i+1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(x => String(x).padStart(10,'0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(pdf) };
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CGT_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true,
    permissions: ['clipboard-read','clipboard-write'] });
  const page = await context.newPage();
  const requests = [], errors = [];
  context.on('request', request => requests.push([request.method(), request.url(), request.postData()]));
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.goto(origin + '/Calculadora-Horas-Anuales-CGT/');
  assert.doesNotMatch(await page.locator('body').innerText(), /cartel/i);
  assert.doesNotMatch(await page.locator('#contract').textContent(), /cartel/i);
  assert.equal(await page.locator('#contrato').evaluate(el => el.open), false);
  await page.locator('#contrato > summary').click();
  assert.match(await page.locator('#contractDetails').innerText(), /1\.765 h/);
  await page.locator('#tabla-jornadas summary').click();
  assert.equal(await page.locator('#contractRows tr').count(), 11);
  assert.deepEqual(await page.locator('#contractRows tr').first().locator('td').allTextContents(), ['224','5','8 h','1.765 h','88 h']);
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.locator('#mode').inputValue(), 'pdf');
  assert.equal(await page.locator('#pdf').isVisible(), true);
  assert.equal(await page.locator('#manual').isVisible(), false);
  await page.selectOption('#mode','manual');
  await page.selectOption('#contract',{ label: '25 h · 5 días/semana' });
  assert.match(await page.locator('#contractDetails').innerText(), /1\.120 h/);
  await page.selectOption('#hasExtension', 'yes');
  await page.fill('#extensionHours', '5,5');
  assert.match(await page.locator('#summary').innerText(), /1\.125,5 h/);
  await page.selectOption('#extensionMethod', 'dates');
  await page.selectOption('#extendedContract', { label: '30 h · 5 días/semana' });
  await page.fill('#extensionStart', '2026-07-01');
  await page.fill('#extensionEnd', '2026-07-31');
  assert.match(await page.locator('#summary').innerText(), /1\.139,02 h/);
  await page.selectOption('#hasExtension', 'no');
  await page.fill('#start','2026-07-27');
  await page.locator('#start').dispatchEvent('change');
  await page.locator('[data-field=amount]').fill('484,82');
  assert.match(await page.locator('#summary').innerText(), /484,82 h/);
  assert.equal(await page.locator('#csv').isEnabled(), true);
  await page.click('#copy');
  await page.waitForFunction(() => document.querySelector('#exportStatus').textContent.includes('copiado'));
  assert.match(await page.locator('#exportStatus').innerText(), /copiado/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await page.selectOption('#mode','pdf');
  async function analyze(files, status) {
    await page.setInputFiles('#files', files);
    await page.fill('#name','Persona Sintética');
    await page.click('#run');
    await page.waitForFunction(expected => document.querySelector('#pdfStatus').textContent.includes(expected), status, { timeout: 60000 });
  }
  const a = fixture('Week 01.pdf','2026-01-05');
  await analyze([a], '1 turnos únicos');
  assert.equal(await page.locator('#pdfResultLink').isVisible(), true);
  await page.locator('#pdfResultLink a').click();
  assert.equal(new URL(page.url()).hash, '#resultados');
  assert.match(await page.locator('#notice').innerText(), /05\/01\/2026 a 11\/01\/2026.*parte del año/);
  assert.match(await page.locator('#vacation').innerText(), /1 fechas/);
  assert.match(await page.locator('#summary').innerText(), /8 h/);
  await page.selectOption('#contract',{ label: '39,4 h · 5 días/semana' });
  assert.match(await page.locator('#summary').innerText(), /7,5 h/);
  await page.locator('#turnOptions > summary').click();
  await page.locator('#turns summary').click();
  const rest = page.locator('#turns input').first();
  await rest.fill('0');
  await rest.dispatchEvent('change');
  await page.locator('a[href="#ajustes"]').click();
  await page.selectOption('#hasComplementary','yes');
  await page.fill('#complementary','1');
  await page.fill('#included','1');
  const summary = await page.locator('#summary').innerText();
  assert.match(summary, /Ordinarias registradas\s*7 h/);
  assert.match(summary, /Total con complementarias\s*8 h/);
  await page.fill('#included', '');
  assert.match(await page.locator('#summary').innerText(), /Total con complementarias\s*9 h/);
  await page.selectOption('#hasExtension', 'yes');
  await page.selectOption('#extensionMethod', 'hours');
  await page.fill('#extensionHours', '');
  await page.fill('#extensionWorked', '2');
  assert.match(await page.locator('#summary').innerText(), /Ordinarias registradas\s*10 h/);
  assert.match(await page.locator('#summary').innerText(), /Total con complementarias\s*11 h/);
  assert.match(await page.locator('#notice').innerText(), /Indica las horas de ampliación acordadas/);
  await page.selectOption('#hasExtension', 'no');
  async function download(button) {
    const [file] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
    return readFile(await file.path(), 'utf8');
  }
  assert.match(await download('#csv'), /06\/01\/2026";"Vacaciones/);
  assert.match(await download('#downloadPdf'), /^%PDF-1.4/);

  await analyze([fixture('garantizada.pdf','2026-01-05','17:00',0,true), fixture('libre.pdf','2026-01-12')], '2 turnos únicos');
  assert.match(await page.locator('#weekendDates').textContent(), /Garantizados \(G\).*10\/01\/2026.*Libres sin G.*17\/01\/2026/);

  await analyze([a, { ...a, name: 'copia.pdf' }, fixture('otra.pdf','2026-01-19')], '1 duplicados omitidos');
  assert.match(await page.locator('#notice').innerText(), /12\/01\/2026/);
  await analyze([a, fixture('revision.pdf','2026-01-05','16:00')], 'Resuelve los conflictos');
  assert.equal(await page.locator('#pdfResultLink').isVisible(), false);
  await page.locator('#versions select').selectOption('1');
  await page.selectOption('#contract',{ label: '30 h · 5 días/semana' });
  assert.match(await page.locator('#summary').innerText(), /Trabajo efectivo registrado\s*7 h/);

  await analyze([fixture('cambio.pdf','2026-12-28','17:00',4)], '0 turnos únicos');
  await page.locator('.pdf-options > summary').click();
  await page.fill('#year','2027');
  await page.locator('#year').dispatchEvent('change');
  assert.match(await page.locator('#notice').innerText(), /01\/01\/2027 a 03\/01\/2027.*solo permite/);
  assert.match(await page.locator('#summary').innerText(), /8 h/);

  await analyze([{ name:'ilegible.pdf', mimeType:'application/pdf', buffer: Buffer.from('No es un PDF') }], 'ninguna rota verificable');
  assert.match(await page.locator('#warnings').innerText(), /PDF ilegible/);
  assert.equal(await page.locator('#pdfResultLink').isVisible(), false);

  const full = Array.from({length:53}, (_, i) => fixture('Week ' + (i%26 + 1) + '.pdf', add('2025-12-29', i*7), '17:00', i === 0 ? 3 : 0));
  await page.fill('#year','2026');
  await analyze(full, '53 turnos únicos');
  assert.match(await page.locator('#notice').innerText(), /01\/01\/2026 a 31\/12\/2026/);
  assert.doesNotMatch(await page.locator('#notice').innerText(), /sin cobertura|parte del año/);
  assert.match(await page.locator('#summary').innerText(), /424 h/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.doesNotMatch(await page.locator('body').innerText(), /PERSONA SINTETICA|EMPLEADO AJENO/i);
  assert.ok(requests.every(([method, url, data]) => method === 'GET' && url.startsWith(origin + '/') && data === null), JSON.stringify(requests));
  assert.deepEqual(errors, []);
  await page.setInputFiles('#files', full);
  await page.fill('#name','Persona Sintética');
  await page.click('#run');
  await page.click('#cancel');
  await page.waitForFunction(() => document.querySelector('#pdfStatus').textContent.includes('cancelado'));
  await page.click('#reset');
  assert.equal(await page.locator('#turns').innerText(), '');
  assert.equal(await page.locator('#csv').isEnabled(), false);
  console.log('Prueba Chromium móvil: lectura, 53 rotas, conflictos, duplicados, vacaciones, descanso, cambio de año, exportaciones y tráfico verificados.');
} finally {
  await browser?.close();
  server.close();
}
