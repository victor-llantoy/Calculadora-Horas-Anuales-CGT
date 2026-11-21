import { add, date, duration } from './calculator.mjs?v=horas-y-descansos';

export const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = value => normalize(value).split(' ').filter(Boolean).sort().join(' ');
const columns = [215,259,304,348,393,437,482,526,570,614,660,704,748,792];

export function scheduleColumns(items) {
  const positions = items.filter(item => /^\d{1,2}:\d{2}$/.test(item.str?.trim()))
    .map(item => item.transform[4]).sort((a, b) => a - b);
  const clusters = [];
  for (const x of positions) {
    const previous = clusters.at(-1);
    if (previous && x - previous[0] <= 8) previous.push(x);
    else clusters.push([x]);
  }
  const centers = clusters.map(cluster => cluster[Math.floor(cluster.length / 2)]);
  const labels = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']
    .flatMap(day => [day + ' IN', day + ' OUT']);
  const header = labels.map(label => items.find(item => normalize(item.str ?? '') === label)?.transform[4]);
  if (header.every((x, i) => Number.isFinite(x) && (i === 0 || x - header[i - 1] > 25))) {
    // PDF text starts to the right of the header's left edge.
    const offsets = centers.map(x => x - header.findLast(edge => edge <= x))
      .filter(offset => offset >= 0 && offset <= 24).sort((a, b) => a - b);
    const inset = offsets[Math.floor(offsets.length / 2)] ?? 15;
    return header.map(x => x + inset);
  }
  if (centers.length === 14 && centers.every((x, i) => i === 0 || Math.abs(x - centers[i - 1] - (centers[13] - centers[0]) / 13) <= 5)) return centers;
  return positions.every(x => columns.some(column => Math.abs(column - x) <= 8)) ? columns : null;
}

export function filenameStart(name) {
  return dates(name)[0];
}

function dates(text) {
  return [...text.matchAll(/\b(?:(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})|(\d{2})(\d{2})(20\d{2}))\b/g)]
    .map(([, d, m, y, compactDay, compactMonth, compactYear]) =>
      (y ?? compactYear) + '-' + (m ?? compactMonth).padStart(2, '0') + '-' + (d ?? compactDay).padStart(2, '0'))
    .filter(day => Number.isFinite(date(day)));
}
export function startDate(name, pages) {
  const listed = dates(name);
  // Prefer a coherent seven-day range over an isolated heading date.
  const headings = pages.map(items => {
    const top = Math.max(...items.map(item => item.transform?.[5] ?? -Infinity));
    return items.filter(item => item.transform?.[5] >= top - 120).map(item => item.str).join(' ');
  });
  const explicit = new Set();
  for (const heading of headings) {
    const match = /HORARIOS?\s+DEL\s+(\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{4}20\d{2})\s*(?:[-–]|AL?)\s*(\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{4}20\d{2})/i.exec(heading);
    if (!match) continue;
    const [first, last] = dates(match[0]);
    if (!first || last !== add(first, 6)) return null;
    explicit.add(first);
  }
  if (explicit.size) return explicit.size === 1 ? [...explicit][0] : null;
  const available = new Set(headings.flatMap(dates));
  const headingStarts = [...available].filter(day => available.has(add(day, 6)));
  const filenameRange = listed.length === 2 && listed[1] === add(listed[0], 6);
  if (headingStarts.length === 1) return listed.length && listed[0] !== headingStarts[0] ? null : headingStarts[0];
  if (headingStarts.length > 1) return null;
  return listed.length === 1 || filenameRange ? listed[0] : null;
}

function clock(value) {
  const minutes = duration(value);
  return minutes !== null && minutes < 1440 && /^\d{1,2}:\d{2}$/.test(value) ? minutes : null;
}
export function parsePage(items, name, start, documentLayout) {
  const lines = [];
  for (const item of items) {
    const t = item.str?.trim();
    if (!t) continue;
    const [, , , , x, y] = item.transform;
    let line = lines.find(row => Math.abs(row.y - y) < 2);
    if (!line) lines.push(line = { y, parts: [] });
    line.parts.push({ x, t });
  }
  const layout = scheduleColumns(items) ?? documentLayout;
  const nameBoundary = layout ? layout[0] - 12 : 153;
  const matches = lines.filter(line => {
    const label = line.parts.filter(cell => cell.x < nameBoundary).sort((a, b) => a.x - b.x)
      .map(cell => cell.t).join(' ').replace(/^\d{8}\s+/, '').replace(/\s+Planta\s+\S+$/i, '');
    return tokens(label) === tokens(name);
  });
  if (matches.length !== 1) return { records: [], matched: false, ambiguous: matches.length > 1, issues: [] };
  if (!layout) return { records: [], matched: true, ambiguous: false, issues: [start] };
  const cells = Array.from({ length: 14 }, () => []);
  for (const {x, t} of matches[0].parts.filter(c => c.x >= nameBoundary)) {
    const distance = layout.map(column => Math.abs(column - x));
    const nearest = distance.indexOf(Math.min(...distance));
    if (distance[nearest] <= 12) cells[nearest].push(t);
  }
  const records = [], issues = [];
  for (let i = 0; i < 7; i++) {
    const day = add(start, i);
    const pair = cells.slice(i * 2, i * 2 + 2);
    const values = pair.flat();
    const vacation = values.some(value => /^V$/i.test(value));
    const malformed = values.some(value => value.includes(':') && clock(value) === null);
    const [entries, exits] = pair.map(values => [...new Set(values.map(clock).filter(value => value !== null))]);
    if (malformed) issues.push(day);
    else if (vacation && !entries.length && !exits.length) records.push({ date: day, kind: 'vacation' });
    else if (entries.length || exits.length || vacation) {
      const presence = (exits[0] - entries[0] + 1440) % 1440;
      if (vacation || entries.length !== 1 || exits.length !== 1 || !(presence > 0 && presence <= 960)) {
        issues.push(day);
      } else records.push({ date: day, kind: 'shift', in: entries[0], out: exits[0], presence });
    }
  }
  return { records, matched: true, ambiguous: false, issues };
}
export const recordKey = r => [r.date, r.kind, r.in, r.out].join('|');
export function groupVersions(documents) {
  const groups = new Map();
  let duplicates = 0;
  for (const doc of documents) {
    const versions = groups.get(doc.start) || [];
    const signature = JSON.stringify([doc.records.map(recordKey).sort(), [...doc.issues].sort()]);
    if (versions.some(entry => entry.signature === signature)) duplicates++;
    else versions.push({ ...doc, signature });
    groups.set(doc.start, versions);
  }
  return { groups, duplicates };
}
export function selectRecords(groups, choices) {
  const records = new Map(), coverage = new Set(), conflicts = new Set();
  for (const [start, versions] of groups) {
    const selected = versions.length === 1 ? versions[0] : versions[choices.get(start)];
    if (!selected) { conflicts.add(start); continue; }
    if (!selected.issues.length) for (let i = 0; i < 7; i++) coverage.add(add(start, i));
    for (const row of selected.records) {
      const previous = records.get(row.date);
      if (previous && recordKey(previous) !== recordKey(row)) conflicts.add(row.date);
      else records.set(row.date, row);
    }
  }
  return { records: [...records.values()].sort((a,b) => a.date.localeCompare(b.date)), coverage, conflicts };
}
