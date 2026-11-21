import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contracts, date, duration, reference, totals, compare, missingWeeks } from '../js/calculator.mjs';
import { startDate, parsePage, groupVersions, selectRecords } from '../js/rota-parser.mjs';
import { buildPdf } from '../js/reports.mjs';

test('referencias originales, fechas inclusivas y redondeo en minutos', () => {
  assert.deepEqual(contracts.map(row => row.slice(1, 3)), [[1765,89],[1568,78],[1434,72],[1344,67],[1120,56],[1075,54],[896,45],[896,45],[806,40],[880,44],[538,27],[538,27]]);
  for (const contract of contracts) {
    assert.equal(reference(contract, '2026-01-01', '2026-12-31').ordinary, contract[1] * 60);
  }
  assert.deepEqual(reference(contracts[4], '2026-07-27', '2026-12-31'), { days: 158, ordinary: 29089, irregular: 1454 });
  assert.equal((1120 * 158 / 365).toFixed(2), '484.82');
  assert.equal(reference(contracts[4], '2026-12-31', '2026-12-31').days, 1);
  assert.equal(reference(contracts[4], '2026-12-31', '2027-01-01'), null);
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
