// Datas e horários do FoodFind sempre no fuso America/Sao_Paulo.
const TZ = 'America/Sao_Paulo';
const DAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
});

function zonedParts(date = new Date()) {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map(x => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  };
}

// Diferença (ms) entre o horário de São Paulo e o UTC em um instante.
function offsetMs(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Converte "2026-11-20T19:30" (horário de São Paulo, sem fuso) para Date (UTC).
// Também aceita datas ISO completas com Z ou deslocamento (+00:00).
function parseSaoPaulo(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || (se || 0) > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, se || 0);
  let utc = guess - offsetMs(new Date(guess));
  utc = guess - offsetMs(new Date(utc)); // ajusta em caso de mudança de horário
  const check = zonedParts(new Date(utc));
  if (check.day !== d || check.month !== mo) return null; // ex.: 31/02
  return new Date(utc);
}

// "2026-11-20T19:30" no fuso de São Paulo (formato do <input type="datetime-local">).
function toSaoPauloInput(iso) {
  const p = zonedParts(new Date(iso));
  const z = n => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

// Texto legível em português: "20/11/2026 19:30".
function formatSaoPaulo(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Dia da semana e minutos do dia agora em São Paulo.
function nowInSaoPaulo(date = new Date()) {
  const p = zonedParts(date);
  return { dayKey: DAY_KEYS[p.weekday], dayIndex: p.weekday, minutes: p.hour * 60 + p.minute };
}

function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// Horário cadastrado no FoodFind: { seg: { closed, open, close }, ... }.
// Considera horários que passam da meia-noite (ex.: 18:00 às 02:00).
function isOpenBySchedule(schedule, date = new Date()) {
  if (!schedule || !Object.values(schedule).some(d => d && !d.closed)) return null;
  const now = nowInSaoPaulo(date);
  const today = schedule[now.dayKey];
  const yesterday = schedule[DAY_KEYS[(now.dayIndex + 6) % 7]];
  if (today && !today.closed && today.open && today.close) {
    const o = toMin(today.open), c = toMin(today.close);
    if (c > o ? now.minutes >= o && now.minutes < c : now.minutes >= o) return true;
  }
  if (yesterday && !yesterday.closed && yesterday.open && yesterday.close) {
    const o = toMin(yesterday.open), c = toMin(yesterday.close);
    if (c <= o && now.minutes < c) return true;
  }
  return false;
}

module.exports = { TZ, DAY_KEYS, parseSaoPaulo, toSaoPauloInput, formatSaoPaulo, nowInSaoPaulo, isOpenBySchedule, toMin };
