import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contracts, date, duration, decimalHours, rotaRest, reference, totals, compare, missingWeeks, freeWeekends } from '../js/calculator.mjs';
import { startDate, parsePage, scheduleColumns, groupVersions, selectRecords } from '../js/rota-parser.mjs';
import { buildPdf } from '../js/reports.mjs';

test('referencias originales, fechas inclusivas y redondeo en minutos', () => {
  assert.deepEqual(contracts.map(([label, ...values]) => [label.split(" · ")[0], ...values]), [["39,4 h", 1765, 88, 224, 5, 8], ["37,5 h", 1680, 84, 224, 5, 7.5], ["32 h", 1434, 72, 179, 4, 8], ["30 h", 1344, 67, 224, 5, 6], ["28 h", 1254, 63, 179, 4, 7], ["25 h", 1120, 56, 224, 5, 5], ["24 h", 1075, 54, 179, 4, 6], ["20 h", 896, 45, 224, 5, 4], ["18 h", 806, 40, 134, 3, 6], ["16 h", 880, 44, 110, 2, 8], ["12 h", 538, 27, 90, 2, 6]]);
  for (const contract of contracts) {
    assert.equal(reference(contract, '2026-01-01', '2026-12-31').ordinary, contract[1] * 60);
  }
  assert.deepEqual(reference(contracts.find(([label]) => label.startsWith("25 h ")), '2026-07-27', '2026-12-31'), { days: 158, ordinary: 29089, irregular: 1454 });
  assert.equal((1120 * 158 / 365).toFixed(2), '484.82');
  assert.equal(reference(contracts.find(([label]) => label.startsWith("25 h ")), '2026-12-31', '2026-12-31').days, 1);
  assert.equal(reference(contracts.find(([label]) => label.startsWith("25 h ")), '2026-12-31', '2027-01-01'), null);
  assert.ok(Number.isNaN(date('2026-02-30')));
});

test('duración, descanso y complementarias con y sin solapamiento', () => {
  assert.equal(duration('37:30'), 2250);
  assert.equal(duration('37.5'), null);
  assert.equal(duration('37:60'), null);
  const shifts = Array.from({ length: 224 }, (_, index) => ({ presence: index < 52 ? 502 : 503, rest: 30 }));
  assert.deepEqual(totals(shifts), { presence: 112620, rest: 6720, effective: 105900, vacation: 0 });
  assert.equal(totals([{ presence: 480, rest: 0 }, { kind: 'vacation' }]).effective, 480);
  assert.deepEqual(compare(495 * 60, 1200, 1200, 28985), { ordinary: 28500, all: 29700, difference: 485 });
  assert.equal(compare(475 * 60, 1200, 0, 28985).all, 29700);
  assert.equal(compare(60, 10, 20, 100), null);
});

const cell = (str, x, y = 200) => ({ str, transform: [1,0,0,1,x,y] });
test('identidad inequívoca, V, fecha real, medianoche e incompletos', () => {
  const items = [cell('Persona Sintética', 30), cell('22:00', 215), cell('06:00', 259), cell('V', 304),
    cell('09:60', 393), cell('12:00', 437), cell('1:00', 482), cell('Otra Persona', 30, 180), cell('10:00', 215, 180)];
  const start = startDate('Week 1.pdf', [[cell('28/12/2026 al 03/01/2027', 20, 520), ...items]]);
  assert.equal(start, '2026-12-28');
  const parsed = parsePage(items, 'Sintética Persona', start);
  assert.deepEqual(parsed.records, [{ date: '2026-12-28', kind: 'shift', in: 1320, out: 360, presence: 480 },
    { date: '2026-12-29', kind: 'vacation' }]);
  assert.deepEqual(parsed.issues, ['2026-12-30','2026-12-31']);
  assert.equal(parsePage([...items, cell('Persona Sintética', 30, 160)], 'Persona Sintética', start).ambiguous, true);
  assert.equal(parsePage(items, 'Otra Sintética', start).matched, false);
  assert.equal(startDate('01.01.2026.pdf', [[cell('28/12/2026 al 03/01/2027', 20, 520), ...items]]), null);
});

test('copias, versiones, solapamientos y huecos de cobertura', () => {
  const first = { start: '2026-01-05', issues: [], records: [{ date:'2026-01-05',kind:'shift',in:540,out:600 }] };
  const revision = { ...first, records: [{ ...first.records[0], out:660 }] };
  const { groups, duplicates } = groupVersions([first, { ...first, number:2 }, revision]);
  assert.equal(duplicates, 1);
  assert.equal(selectRecords(groups, new Map()).conflicts.size, 1);
  const chosen = selectRecords(groups, new Map([[first.start,1]]));
  assert.equal(chosen.records[0].out, 660);
  assert.equal(chosen.coverage.size, 7);
  assert.deepEqual(missingWeeks(first.start, '2026-01-19', new Set([first.start])), ['2026-01-12','2026-01-19']);
});

test('PDF paginado, referencias cruzadas y caracteres escapados', () => {
  const pdf = buildPdf(['Gran Vía (Madrid)', ...Array.from({length:53}, (_, index) => 'Semana ' + index)]);
  assert.match(pdf, /\/Count 2/);
  const offset = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(offset, offset + 4), 'xref');
  assert.ok(pdf.includes('V\\355a \\050Madrid\\051'));
});

test('horas decimales y límites del descanso de las rotas', () => {
  assert.equal(decimalHours('8'), 480);
  assert.equal(decimalHours('8,5'), 510);
  assert.equal(decimalHours('8.5'), 510);
  assert.equal(decimalHours('8:30'), null);
  assert.equal(rotaRest(30, 510), 0);
  assert.equal(rotaRest(32, 360), 0);
  assert.equal(rotaRest(32, 390), 30);
  assert.equal(510 - rotaRest(39.4, 510), 480);
});

test('columnas de una rota con el lunes sin turnos y año incorrecto en el nombre', () => {
  const labels = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO']
    .flatMap(day => [day + ' IN', day + ' OUT']);
  const headers = labels.map((label, i) => cell(label, 158 + 47.5 * i, 500));
  const items = [cell('Persona Sintética', 52), cell('16:00', 268), cell('21:00', 316)];
  const start = startDate('06.01.2024 - 12.01.2024.pdf', [[cell('HORARIO DEL 06/01/2025 - 12/01/2025', 25, 520)]]);
  assert.equal(start, '2025-01-06');
  assert.deepEqual(parsePage(items, 'Persona Sintética', start, scheduleColumns([...headers, ...items])).records,
    [{ date: '2025-01-07', kind: 'shift', in: 960, out: 1260, presence: 300 }]);
});

test('formato 2026 con planta, fechas compactas y cabecera con al', () => {
  const start = startDate('WEEK 26 - 09032026 AL 15032026.pdf', [
    [cell('HORARIO DEL 09/03/2026 AL 15/03/2026', 25, 520)],
  ]);
  assert.equal(start, '2026-03-09');
  const row = parsePage([cell('12345678 Persona Sintética Planta 4', 50), cell('16:00', 215), cell('21:00', 259)],
    'Persona Sintética', start);
  assert.equal(row.records[0].presence, 300);
});

test('ampliación temporal prorratea solo los días coincidentes con el período', () => {
  const base = contracts.find(([label]) => label.startsWith('25 h '));
  const contract = contracts.find(([label]) => label.startsWith('30 h '));
  const extension = { contract, start: '2026-07-01', end: '2026-07-31' };
  assert.equal(reference(base, '2026-01-01', '2026-12-31', extension).ordinary, Math.round((1120 * 334 + 1344 * 31) * 60 / 365));
  assert.deepEqual(reference(base, '2026-07-01', '2026-07-31', extension), reference(contract, '2026-07-01', '2026-07-31'));
  assert.deepEqual(reference(base, '2026-08-01', '2026-08-31', extension), reference(base, '2026-08-01', '2026-08-31'));
});

test('cuenta solo fines de semana completos y distingue G, vacaciones y próximos', () => {
  const start = '2026-01-05';
  const marked = parsePage([cell('Persona Sintética', 50), cell('G', 660), cell('G', 704)], 'Persona Sintética', start);
  assert.deepEqual(marked.records, [{ date: '2026-01-10', kind: 'guaranteed' }]);
  const coverage = new Set(['2026-01-10','2026-01-11','2026-01-17','2026-01-18','2026-01-24','2026-01-25','2026-01-31']);
  const result = freeWeekends(2026, [...marked.records, { date: '2026-01-24', kind: 'vacation' }], coverage, '2026-01-15');
  assert.deepEqual(result.guaranteed, [{ saturday: '2026-01-10', sunday: '2026-01-11', past: true }]);
  assert.deepEqual(result.unmarked, [{ saturday: '2026-01-17', sunday: '2026-01-18', past: false }]);
  assert.equal(result.unavailable, 49);
});
