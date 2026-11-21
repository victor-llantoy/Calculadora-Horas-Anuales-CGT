export const contracts=[
["39,5 h · 5 días/semana",1765,89,224,5,8],
["35 h · 5 días/semana",1568,78,224,5,7],
["32 h · 5 días/semana",1434,72,179,5,6.5],
["30 h · 5 días/semana",1344,67,224,5,6],
["25 h · 5 días/semana",1120,56,224,5,5],
["24 h · 4 días/semana",1075,54,179,4,6],
["20 h · 5 días/semana",896,45,224,5,4],
["20 h · 4 días/semana",896,45,179,4,5],
["18 h · 3 días/semana",806,40,110,3,6],
["16 h · 2 días/semana",880,44,110,2,8],
["12 h · 2 días/semana",538,27,90,2,6],
["12 h · 3 días/semana",538,27,134,3,4]
];
export const formatDate = day => day.split('-').reverse().join('/');
const DAY = 86400000;
export function date(value) {
  const parsed = new Date(value + 'T00:00:00Z');
  return /^20\d\d-\d\d-\d\d$/.test(value) && Number.isFinite(+parsed) &&
    parsed.toISOString().slice(0, 10) === value ? +parsed : NaN;
}
export const add = (day, offset) => new Date(date(day) + offset * DAY).toISOString().slice(0, 10);
export const week = day => add(day, -((new Date(date(day)).getUTCDay() + 6) % 7));
export function duration(value) {
  const match = /^(\d{1,5}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
const hoursDisplay = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });
export function format(value) {
  return value == null ? '—' : hoursDisplay.format(value / 60) + ' h';
}
export function reference(contract, start, end) {
  const days = (date(end) - date(start)) / DAY + 1;
  if (!(days >= 1) || start.slice(0, 4) !== '2026' || end.slice(0, 4) !== '2026') return null;
  const [, annual, irregular] = contract;
  return { days, ordinary: Math.round(annual * 60 * days / 365),
    irregular: Math.round(irregular * 60 * days / 365) };
}
export function totals(records) {
  return records.reduce((sum, row) => {
    if (row.kind === 'vacation') sum.vacation++;
    else {
      sum.presence += row.presence;
      sum.rest += row.rest;
      sum.effective += row.presence - row.rest;
    }
    return sum;
  }, { presence: 0, rest: 0, effective: 0, vacation: 0 });
}
export function compare(effective, complementary, included, expected) {
  if ([effective, complementary, included].some(n => !Number.isSafeInteger(n) || n < 0) ||
      included > complementary || included > effective) return null;
  const ordinary = effective - included;
  return { ordinary, all: ordinary + complementary, difference: expected == null ? null : expected - ordinary };
}
export function missingWeeks(start, end, covered) {
  const missing = [];
  for (let day = week(start); day <= end; day = add(day, 7)) if (!covered.has(day)) missing.push(day);
  return missing;
}
