import { contracts, date, add, week, duration, format, reference, totals, compare, missingWeeks } from './calculator.mjs';
import { groupVersions, normalize, recordKey, selectRecords } from './rota-parser.mjs';
import { readRotas } from './pdf-reader.mjs';
import { exportCsv, exportPdf } from './reports.mjs';

const $ = id => document.getElementById(id);
const value = id => $(id).value;
const say = (id, text) => { $(id).textContent = text; };
function node(type, text, parent) {
  const element = document.createElement(type);
  if (text != null) element.textContent = text;
  parent?.append(element);
  return element;
}
function metrics(id, entries) {
  const container = $(id);
  container.replaceChildren();
  for (const [label, val] of entries) {
    const group = node('div', null, container);
    node('dt', label, group);
    node('dd', val, group);
  }
}

const clock = minutes => Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
let groups = new Map(), choices = new Map(), rests = new Map();
let selected = null, applied = false, controller = null, report = null, entryId = 0;
let warnings = [], documentCount = 0, duplicateCount = 0;
let adjustmentPeriod = null, manualPeriod = null;

function addEntry() {
  const entry = node('div', null, $('entries'));
  entry.className = 'entry grid';
  const id = ++entryId;
  const fields = [
    ['date', 'Inicio de semana o mes', 'date'],
    ['amount', 'Horas registradas (horas:minutos)', 'text'],
    ['rest', 'Descanso no computable (horas:minutos)', 'text']
  ];
  for (const [key, label, type] of fields) {
    const field = node('div', null, entry);
    node('label', label, field).htmlFor = key + id;
    const input = node('input', null, field);
    input.id = key + id;
    input.type = type;
    input.autocomplete = 'off';
    input.dataset.field = key;
    if (type === 'text') input.placeholder = '0:00';
  }
  const remove = node('button', 'Quitar período', entry);
  remove.type = 'button';
  remove.className = 'btn subtle';
  remove.addEventListener('click', () => {
    entry.remove();
    if (!$('entries').children.length) addEntry();
    recalculate();
  });
  syncEntries();
}
function syncEntries() {
  const total = value('entryMode') === 'total';
  for (const entry of $('entries').children) {
    entry.querySelector('[data-field=date]').parentElement.hidden = total;
    entry.querySelector('[data-field=rest]').parentElement.hidden = value('manualKind') === 'net';
    entry.querySelector('button').hidden = total;
  }
  $('addEntry').hidden = total;
}
function clearEntries() {
  $('entries').replaceChildren();
  addEntry();
}
function manualInput(start, end) {
  const mode = value('entryMode'), net = value('manualKind') === 'net';
  const records = [], seen = new Set();
  for (const entry of $('entries').children) {
    const fields = Object.fromEntries([...entry.querySelectorAll('input')].map(input => [input.dataset.field, input.value]));
    if (!Object.values(fields).some(Boolean)) continue;
    const amount = duration(fields.amount), rest = net ? 0 : duration(fields.rest);
    if (amount == null || rest == null || rest > amount) throw Error('Revisa horas y descansos. Usa horas:minutos y un descanso igual o menor que la presencia.');
    const day = mode === 'total' ? start : fields.date;
    if (!Number.isFinite(date(day))) throw Error('Indica una fecha válida para cada registro.');
    const monthly = mode === 'monthly';
    if (monthly && !day.endsWith('-01') || mode === 'weekly' && week(day) !== day) throw Error('Empieza cada registro mensual el día 1 y cada registro semanal el lunes.');
    const bucketEnd = mode === 'weekly' ? add(day, 6) : monthly
      ? new Date(Date.UTC(+day.slice(0,4), +day.slice(5,7), 0)).toISOString().slice(0,10) : end;
    if (day > end || bucketEnd < start) throw Error('Hay un registro fuera del período seleccionado.');
    if (seen.has(day)) throw Error('Hay dos registros para la misma fecha de inicio.');
    seen.add(day);
    records.push({ date: day, kind: 'manual', presence: amount, rest });
  }
  const covered = new Set();
  if (mode === 'weekly') for (const record of records) covered.add(record.date);
  const holes = mode === 'weekly' ? missingWeeks(start, end, covered) : [];
  if (mode === 'monthly') {
    for (let month = start.slice(0,7) + '-01'; month <= end; ) {
      if (!seen.has(month)) holes.push(month);
      month = new Date(Date.UTC(+month.slice(0,4), +month.slice(5,7), 1)).toISOString().slice(0,10);
    }
  }
  return { records, net, holes, mode };
}

function recalculate() {
  const contract = contracts[Number(value('contract'))];
  const [label, annual, irregular, yearDays, days, daily] = contract;
  metrics('contractDetails', [['Horas anuales', format(annual * 60)], ['Irregular según cartel', format(irregular * 60)],
    ['Distribución habitual', days + ' días × ' + format(daily * 60)], ['Días del cartel', yearDays]]);
  const pdf = value('mode') === 'pdf';
  $('pdf').hidden = !pdf;
  $('manual').hidden = pdf;
  const hasComplementary = value('hasComplementary') === 'yes';
  const hasIrregular = value('hasIrregular') === 'yes';
  $('complementaryFields').hidden = !hasComplementary;
  $('irregularFields').hidden = !hasIrregular;
  report = null;
  $('detail').replaceChildren();
  $('summary').replaceChildren();
  say('vacation', 'Sin información de vacaciones.');
  say('exportStatus', '');
  setExport(false);
  if (pdf && (!applied || !selected)) return say('notice', 'Analiza y revisa tus rotas antes de usar sus horas.');
  const start = pdf ? selected.start : value('start');
  const end = pdf ? selected.end : value('end');
  if (!Number.isFinite(date(start)) || !Number.isFinite(date(end)) || start > end) return say('notice', 'Indica un período válido con el final igual o posterior al inicio.');
  const period = start + '/' + end + '/' + value('mode');
  const expected = reference(contract, start, end);
  let data;
  try { data = pdf ? selected : manualInput(start, end); }
  catch (error) { return say('notice', error.message); }

  const summary = totals(data.records);
  const available = pdf || data.records.length > 0;
  const supplementary = hasComplementary ? duration(value('complementary')) : 0;
  const included = hasComplementary ? duration(value('included')) : 0;
  const irregularUsed = hasIrregular ? duration(value('irregular')) : 0;
  const stale = (hasComplementary || hasIrregular) && adjustmentPeriod !== null && adjustmentPeriod !== period;
  const comparison = available && !stale ? compare(summary.effective, supplementary, included, expected?.ordinary) : null;
  const notices = [start + ' a ' + end + '.'];
  if (!expected) notices.push('El cartel disponible solo permite comparar períodos íntegramente de 2026.');
  if (!available) notices.push('Introduce las horas del período para obtener la comparación.');
  if (stale) notices.push('Revisa y vuelve a introducir las horas complementarias e irregulares para este período.');
  if (available && !comparison && !stale) notices.push('Revisa las complementarias: indica ambas cantidades, y las ya incluidas no pueden superar las declaradas ni el total efectivo.');
  if (irregularUsed == null) notices.push('Indica las horas de distribución irregular en formato horas:minutos.');
  if (!pdf && data.mode !== 'total') notices.push('En la primera y última semana o mes, registra solo las horas comprendidas entre las fechas indicadas.');
  if (data.holes.length) notices.push('Períodos sin cobertura completa: ' + data.holes.join(', ') + '.');
  if (pdf) {
    notices.push(documentCount + ' documentos seleccionados, ' + duplicateCount + ' duplicados omitidos.');
    if (warnings.length) notices.push('Hay avisos en el lector de rotas.');
    if (start.slice(5) !== '01-01' || end.slice(5) !== '12-31') notices.push('Las rotas solo cubren parte del año.');
  }
  notices.push('La comparación es provisional y no acredita horas pendientes de recuperación.');
  say('notice', notices.join(' '));
  say('vacation', pdf ? summary.vacation + ' fechas con marca V dentro de las rotas seleccionadas.' : 'Las vacaciones se identifican al leer rotas PDF.');
  const entries = [
    ['Referencia anual 2026', format(annual * 60)],
    ['Referencia proporcional', format(expected?.ordinary)],
    ['Presencia', format(available && !data.net ? summary.presence : null)],
    ['Días trabajados identificados', pdf ? data.records.length - summary.vacation : '—'],
    ['Vacaciones identificadas (V)', pdf ? summary.vacation : '—'],
    ['Descansos descontados', format(available && !data.net ? summary.rest : null)],
    ['Trabajo efectivo registrado', format(available ? summary.effective : null)],
    ['Ordinarias registradas', format(comparison?.ordinary)],
    ['Complementarias declaradas', format(stale ? null : supplementary)],
    ['Complementarias ya incluidas', format(stale ? null : included)],
    ['Total con complementarias', format(comparison?.all)],
    ['Distribución irregular declarada', format(stale ? null : irregularUsed)],
    ['Irregular anual según cartel', format(irregular * 60)],
    ['Irregular proporcional orientativa', format(expected?.irregular)],
    ['Comparación irregular orientativa', format(expected && !stale && irregularUsed != null ? expected.irregular - irregularUsed : null)],
    ['Diferencia provisional (referencia − ordinarias)', format(data.holes.length || pdf && warnings.length ? null : comparison?.difference)]
  ];
  metrics('summary', entries);
  renderDetail(data.records, pdf, data.net, data.mode);
  if (!available || !comparison || irregularUsed == null) return;
  report = { label, start, end, notices, entries, records: data.records, pdf, net: data.net, mode: data.mode };
  setExport(true);
}

function setExport(enabled) {
  for (const id of ['copy', 'csv', 'downloadPdf', 'print']) $(id).disabled = !enabled;
}
function renderDetail(records, pdf, net, mode) {
  const detail = $('detail');
  const buckets = new Map(), months = new Map();
  for (const row of records) {
    const key = pdf ? week(row.date) : row.date;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
    if (pdf || mode === 'monthly') {
      const month = row.date.slice(0,7);
      months.set(month, (months.get(month) || 0) + (row.kind === 'vacation' ? 0 : row.presence - row.rest));
    }
  }
  if (months.size) {
    node('h3', 'Trabajo efectivo por mes', detail);
    const max = Math.max(1, ...months.values());
    for (const [month, minutes] of [...months].sort()) {
      const line = node('div', null, detail);
      line.className = 'month';
      node('span', month, line);
      const meter = node('meter', null, line);
      meter.max = max;
      meter.value = minutes;
      meter.setAttribute('aria-label', month + ' · ' + format(minutes));
      node('span', format(minutes), line);
    }
  }
  if (!buckets.size) return;
  node('h3', pdf || mode === 'weekly' ? 'Desglose semanal' : mode === 'monthly' ? 'Desglose mensual' : 'Total registrado', detail);
  for (const [key, rows] of [...buckets].sort()) {
    const sum = totals(rows);
    const group = node('details', null, detail);
    group.open = true;
    node('summary', key + ' · ' + format(sum.effective), group);
    if (pdf) node('p', (rows.length - sum.vacation) + ' días trabajados · ' + sum.vacation + ' marcas V', group);
    if (!net) node('p', 'Presencia ' + format(sum.presence) + ' · Descansos ' + format(sum.rest), group);
    if (pdf) for (const row of rows) {
      node('p', row.date + ' · ' + (row.kind === 'vacation' ? 'Vacaciones (V)' :
        clock(row.in) + ' a ' + clock(row.out) + ' · descanso ' + format(row.rest) + ' · efectivo ' + format(row.presence - row.rest)), group);
    }
  }
}
function resetAdjustments() {
  $('hasComplementary').value = $('hasIrregular').value = 'no';
  $('complementary').value = $('included').value = $('irregular').value = '';
  adjustmentPeriod = null;
}
function updatePdf(renderTurns = true) {
  const year = Number(value('year'));
  const { records, coverage, conflicts } = selectRecords(groups, choices);
  const withinYear = day => day.startsWith(String(year));
  const yearRecords = records.filter(row => withinYear(row.date)).map(row => {
    if (row.kind !== 'shift') return row;
    const threshold = Number(value('rule'));
    return { ...row, rest: rests.get(recordKey(row)) ?? (threshold && row.presence >= Math.max(30, threshold) ? 30 : 0) };
  });
  // Incomplete weeks can still be reviewed, but they do not count as coverage.
  const observed = [...groups.keys()].flatMap(day => Array.from({ length: 7 }, (_, i) => add(day, i))).filter(withinYear).sort();
  const start = observed[0], end = observed.at(-1);
  const holes = [];
  if (start) for (let day = week(start); day <= end; day = add(day, 7)) {
    for (let offset = 0; offset < 7; offset++) {
      const current = add(day, offset);
      if (current >= start && current <= end && !coverage.has(current)) {
        holes.push(day);
        break;
      }
    }
  }
  selected = start ? { start, end, records: yearRecords, net: false, holes } : null;
  const blocking = [...conflicts].some(day => withinYear(day) || withinYear(add(day,6)));
  if (!selected || blocking) applied = false;
  $('apply').disabled = !selected || blocking || controller !== null;
  if (!groups.size) return recalculate();
  say('pdfStatus', documentCount + ' documentos analizados · ' + duplicateCount + ' duplicados omitidos · ' +
    yearRecords.filter(row => row.kind === 'shift').length + ' turnos únicos.' +
    (blocking ? ' Resuelve los conflictos antes de usar el total. Si se solapan semanas distintas, vuelve a analizar solo las rotas correctas.' : '') +
    (!selected ? ' No hay cobertura en el año seleccionado.' : ''));
  if (renderTurns) showTurns(yearRecords);
  recalculate();
}
function showTurns(records) {
  const container = $('turns');
  container.replaceChildren();
  let group, lastWeek;
  for (const row of records) {
    const currentWeek = week(row.date);
    if (lastWeek !== currentWeek) {
      group = node('details', null, container);
      node('summary', 'Semana del ' + currentWeek, group);
      lastWeek = currentWeek;
    }
    if (row.kind === 'vacation') { node('p', row.date + ' · Vacaciones (V)', group); continue; }
    const label = node('label', row.date + ' · ' + clock(row.in) + '–' + clock(row.out) + ' · descanso (min)', group);
    const input = node('input', null, label);
    input.type = 'number';
    input.min = '0';
    input.max = String(row.presence);
    input.step = '1';
    input.value = String(row.rest);
    input.addEventListener('change', () => {
      if (!input.value || !input.validity.valid) {
        input.value = String(selected.records.find(record => recordKey(record) === recordKey(row)).rest);
        return;
      }
      rests.set(recordKey(row), Number(input.value));
      updatePdf(false);
    });
  }
}
function showVersions() {
  const container = $('versions');
  container.replaceChildren();
  for (const [start, versions] of groups) {
    if (versions.length === 1) continue;
    const label = node('label', 'Rota en conflicto para ' + start, container);
    const select = node('select', null, label);
    node('option', 'Elegir versión', select).value = '';
    versions.forEach((version, index) => {
      const shifts = version.records.map(row => row.date + ' ' + (row.kind === 'vacation' ? 'V' : clock(row.in) + '–' + clock(row.out)));
      node('option', 'Documento ' + version.number + ' · ' + (shifts.join(', ') || 'sin turnos') +
        (version.issues.length ? ' · con avisos' : ''), select).value = String(index);
    });
    select.addEventListener('change', () => {
      if (select.value === '') choices.delete(start);
      else choices.set(start, Number(select.value));
      applied = false;
      resetAdjustments();
      updatePdf();
    });
  }
}
function clearPdf() {
  controller?.abort();
  controller = null;
  groups = new Map(); choices = new Map(); rests = new Map();
  warnings = []; documentCount = 0; duplicateCount = 0;
  selected = null; applied = false;
  for (const id of ['warnings','versions','turns','pdfStatus']) $(id).replaceChildren();
  $('progress').hidden = true;
  $('cancel').disabled = $('apply').disabled = true;
  $('run').disabled = false;
}
$('run').addEventListener('click', async () => {
  clearPdf();
  resetAdjustments();
  recalculate();
  const files = [...$('files').files];
  const name = value('name').trim();
  if (files.length === 0 || normalize(name).split(' ').length < 2 || !$('year').value || !$('year').validity.valid) {
    return say('pdfStatus', 'Selecciona los PDF, indica tu nombre completo y elige un año válido.');
  }
  const job = controller = new AbortController();
  $('run').disabled = true;
  $('cancel').disabled = false;
  $('progress').hidden = false;
  $('progress').max = files.length;
  $('progress').value = 0;
  try {
    const result = await readRotas(files, name, job.signal, count => {
      $('progress').value = count - 1;
      say('pdfStatus', 'Leyendo documento ' + count + ' de ' + files.length + '…');
    });
    if (controller !== job) return;
    ({ groups, duplicates: duplicateCount } = groupVersions(result.documents));
    warnings = result.warnings;
    documentCount = files.length;
    $('files').value = $('name').value = '';
    for (const message of warnings) node('li', message, $('warnings'));
    showVersions();
    if (!groups.size) say('pdfStatus', 'No se pudo obtener ninguna rota verificable de ' + documentCount + ' archivos.');
  } catch {
    if (controller !== job) return;
    say('pdfStatus', job.signal.aborted ? 'Análisis cancelado.' : 'No se pudo iniciar el lector local.');
  } finally {
    if (controller === job) {
      controller = null;
      $('progress').hidden = true;
      $('run').disabled = false;
      $('cancel').disabled = true;
      updatePdf();
    }
  }
});
$('cancel').addEventListener('click', () => controller?.abort());
$('apply').addEventListener('click', () => {
  applied = true;
  recalculate();
  $('resultados').scrollIntoView();
});
$('year').addEventListener('change', () => {
  applied = false;
  resetAdjustments();
  updatePdf();
});
$('rule').addEventListener('change', () => updatePdf());
for (const id of ['files','name']) $(id).addEventListener('change', () => { clearPdf(); resetAdjustments(); recalculate(); });
$('mode').addEventListener('change', () => { resetAdjustments(); recalculate(); });
for (const id of ['start','end']) $(id).addEventListener('change', () => {
  const period = value('start') + '/' + value('end');
  if (period !== manualPeriod) {
    clearEntries();
    resetAdjustments();
    manualPeriod = period;
  }
  recalculate();
});
$('entryMode').addEventListener('change', () => { clearEntries(); resetAdjustments(); recalculate(); });
$('manualKind').addEventListener('change', () => { syncEntries(); recalculate(); });
$('addEntry').addEventListener('click', addEntry);
$('entries').addEventListener('input', recalculate);
for (const id of ['contract','hasComplementary','hasIrregular','complementary','included','irregular']) {
  $(id).addEventListener('input', () => {
    if (id !== 'contract') adjustmentPeriod = value('mode') === 'pdf'
      ? selected && selected.start + '/' + selected.end + '/pdf' : value('start') + '/' + value('end') + '/manual';
    recalculate();
  });
}
$('reset').addEventListener('click', () => {
  clearPdf();
  resetAdjustments();
  $('files').value = $('name').value = '';
  $('contract').value = '0'; $('mode').value = 'manual';
  $('start').value = '2026-01-01'; $('end').value = '2026-12-31';
  $('year').value = '2026'; $('rule').value = '0'; $('entryMode').value = 'total'; $('manualKind').value = 'net';
  manualPeriod = value('start') + '/' + value('end');
  clearEntries();
  recalculate();
});
function summaryLines() {
  return ['CGT Primark Gran Vía · Resumen provisional', report.label, ...report.notices,
    ...report.entries.map(([label, val]) => label + ' — ' + val)];
}
$('copy').addEventListener('click', async () => {
  if (!report) return;
  const text = summaryLines().join('\n');
  try { await navigator.clipboard.writeText(text); say('exportStatus','Resumen copiado.'); }
  catch { window.prompt('Copia el resumen:', text); }
});
$('csv').addEventListener('click', () => {
  if (!report) return;
  const { entries, records, label, notices, pdf, net, mode } = report;
  const weekly = new Map();
  if (pdf || mode === 'weekly') for (const row of records) {
    const start = week(row.date);
    if (!weekly.has(start)) weekly.set(start, []);
    weekly.get(start).push(row);
  }
  exportCsv([['CGT Primark Gran Vía', label], ...notices.map(note => [note]), ...entries, [],
    ['Semana','Días trabajados','Vacaciones V','Presencia min','Descanso min','Efectivo min'],
    ...[...weekly].sort().map(([day, rows]) => {
      const sum = totals(rows);
      return [day, pdf ? rows.length - sum.vacation : '', pdf ? sum.vacation : '', net ? '' : sum.presence, net ? '' : sum.rest, sum.effective];
    }), [], ['Fecha','Tipo','Entrada','Salida','Presencia min','Descanso min','Efectivo min'],
    ...records.map(row => row.kind === 'vacation' ? [row.date,'Vacaciones (V)'] :
      [row.date,row.kind === 'shift' ? 'Turno' : 'Registro manual', row.in == null ? '' : clock(row.in),
        row.out == null ? '' : clock(row.out), net ? '' : row.presence, net ? '' : row.rest, row.presence - row.rest])]);
});
$('downloadPdf').addEventListener('click', () => {
  if (!report) return;
  const detail = [...$('detail').querySelectorAll('details summary, details p')].map(element => element.textContent);
  exportPdf([...summaryLines(), '', 'Detalle de horas', ...detail]);
});
$('print').addEventListener('click', () => window.print());
contracts.forEach(([label], index) => { node('option', label, $('contract')).value = String(index); });
manualPeriod = value('start') + '/' + value('end');
if (new URLSearchParams(location.search).get('modo') === 'pdf') $('mode').value = 'pdf';
addEntry();
recalculate();
