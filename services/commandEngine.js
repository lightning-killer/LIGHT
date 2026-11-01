// Rule-based command engine. Pure functions (no DB, no network) so it is easy to test.
// parseCommand(text, { now, tzOffsetMinutes }) -> { intent, params }
// tzOffsetMinutes follows JavaScript's Date#getTimezoneOffset (UTC minus local, e.g. IST = -330).

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ---------- local time helpers ----------
export function toLocalParts(date, off = 0) {
  const d = new Date(date.getTime() - off * 60000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
function fromLocalParts(y, mo, d, h, mi, off = 0) {
  return new Date(Date.UTC(y, mo, d, h, mi) + off * 60000);
}
export function formatLocal(date, off = 0, opts = {}) {
  const shifted = new Date(date.getTime() - off * 60000);
  return shifted.toLocaleString('en-US', { timeZone: 'UTC', ...opts });
}
export const formatDateTime = (date, off = 0) =>
  formatLocal(date, off, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- natural-language date/time ----------
/** Extracts a time phrase from text. Returns { when: Date|null, rest, needsTime } */
export function extractWhen(input, now = new Date(), off = 0) {
  let text = ` ${input} `;
  let when = null;
  let dayShift = null;
  let h = null;
  let mi = 0;
  const cut = (re) => { const m = text.match(re); if (m) text = text.replace(re, ' '); return m; };

  let m = cut(/\s(?:in|after)\s+(\d+|an?|half an)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i);
  if (m) {
    const n = /^an?$/i.test(m[1]) ? 1 : /half/i.test(m[1]) ? 0.5 : Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms = unit.startsWith('m') ? 60000 : unit.startsWith('h') ? 3600000 : unit.startsWith('d') ? 86400000 : 604800000;
    return { when: new Date(now.getTime() + n * ms), rest: tidy(text), needsTime: false };
  }

  if (cut(/\sday after tomorrow\b/i)) dayShift = 2;
  else if (cut(/\s(?:tomorrow|tmrw)\b/i)) dayShift = 1;
  else if (cut(/\s(?:today|tonight)\b/i)) { dayShift = 0; if (/tonight/i.test(input)) h = 20; }
  else if ((m = cut(new RegExp(`\\s(?:on\\s+|next\\s+|this\\s+)?(${WEEKDAYS.join('|')})\\b`, 'i')))) {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    const cur = toLocalParts(now, off).wd;
    dayShift = ((target - cur + 7) % 7) || 7;
  }

  if ((m = cut(/\sat\s+(noon|midnight)\b/i))) { h = /noon/i.test(m[1]) ? 12 : 0; }
  else if ((m = cut(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\W|$)/i))) {
    h = Number(m[1]) % 12 + (/p/i.test(m[3]) ? 12 : 0); mi = Number(m[2] || 0);
  } else if ((m = cut(/\sat\s+(\d{1,2}):(\d{2})\b/i))) {
    h = Number(m[1]); mi = Number(m[2]);
  } else if ((m = cut(/\sat\s+(\d{1,2})(?=\s|$)/i))) {
    h = Number(m[1]); // "at 5" -> ambiguous; interpret as 24h unless <=7 (assume pm for evenings)
    if (h >= 1 && h <= 7) h += 12;
  }

  if (h !== null && (h > 23 || mi > 59)) return { when: null, rest: tidy(text), needsTime: true };

  if (dayShift !== null || h !== null) {
    const base = toLocalParts(now, off);
    const hour = h ?? 9;
    let target = fromLocalParts(base.y, base.mo, base.d + (dayShift ?? 0), hour, mi, off);
    if (dayShift === null && target <= now) target = fromLocalParts(base.y, base.mo, base.d + 1, hour, mi, off); // bare "at 5pm" already passed -> tomorrow
    if (target <= now) return { when: null, rest: tidy(text), needsTime: true };
    when = target;
  }
  return { when, rest: tidy(text), needsTime: false };
}

function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/^\s*(?:to|about|that|for|of)\s+/i, '').replace(/[\s,.!?]+$/g, '').trim();
}

// ---------- safe arithmetic (no eval) ----------
export function safeCalc(expr) {
  const src = expr.replace(/\s+/g, '');
  if (!src || !/^[0-9+\-*/^().%]+$/.test(src)) throw new Error('Not a valid expression');
  if (src.length > 200) throw new Error('Expression too long');
  let i = 0;
  const peek = () => src[i];
  const parseExpr = () => {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = parseTerm(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const parseTerm = () => {
    let v = parsePow();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++]; const r = parsePow();
      if ((op === '/' || op === '%') && r === 0) throw new Error('Division by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const parsePow = () => {
    const base = parseUnary();
    if (peek() === '^') { i++; return Math.pow(base, parsePow()); }
    return base;
  };
  const parseUnary = () => {
    if (peek() === '-') { i++; return -parseUnary(); }
    if (peek() === '+') { i++; return parseUnary(); }
    return parseAtom();
  };
  const parseAtom = () => {
    if (peek() === '(') {
      i++; const v = parseExpr();
      if (peek() !== ')') throw new Error('Missing )');
      i++; return v;
    }
    const m = src.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new Error('Unexpected input');
    i += m[0].length; return Number(m[0]);
  };
  const result = parseExpr();
  if (i !== src.length) throw new Error('Unexpected input');
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return result;
}

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000 };

/** Turn "what is 12 times 4 plus 2" into "12*4+2"; returns null if it is not arithmetic. */
export function naturalToExpression(text) {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/[?=!,]/g, ' ').replace(/(\d),(\d{3})/g, '$1$2');
  t = t.replace(/\b(what(?:'s| is)?|calculate|compute|work out|solve|how much is|tell me|can you|please|the (?:result|answer) of|equals?)\b/g, ' ');
  t = t.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)');
  t = t.replace(/(\d+(?:\.\d+)?)\s*percent of\s*(\d+(?:\.\d+)?)/g, '($1/100*$2)');
  t = t.replace(/\bsquare root of\b/g, ' sqrt ');
  t = t.replace(/\bto the power of\b|\bpower\b/g, '^').replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3');
  t = t.replace(/\bmultiplied by\b|\btimes\b|\bx\b|×/g, '*').replace(/\bdivided by\b|\bover\b|÷/g, '/');
  t = t.replace(/\bplus\b|\badd(?:ed to)?\b|\band\b(?=\s*\d)/g, '+').replace(/\bminus\b|\bsubtract(?:ed by)?\b|\bless\b/g, '-');
  t = t.replace(/\bmod(?:ulo)?\b/g, '%');
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/g, (w) => NUMBER_WORDS[w]);
  t = t.trim();
  if (/sqrt/.test(t)) {
    const m = t.match(/^sqrt\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return `__sqrt__${m[1]}`;
  }
  if (!/^[0-9+\-*/^().%\s]+$/.test(t)) return null;
  if (!/\d\s*[+\-*/^%]\s*[-(\d]/.test(t) && !/\(/.test(t)) return null; // needs at least one operator between operands
  return t.replace(/\s+/g, '');
}

export function calculate(text) {
  const expr = naturalToExpression(text);
  if (!expr) return null;
  if (expr.startsWith('__sqrt__')) {
    const n = Number(expr.slice(8));
    return { expression: `sqrt(${n})`, value: Math.sqrt(n) };
  }
  return { expression: expr, value: safeCalc(expr) };
}

// ---------- intent recognition ----------
const clean = (s) => s.replace(/\s+/g, ' ').replace(/[\s.!?]+$/g, '').trim();

export function parseCommand(rawText, { now = new Date(), tzOffsetMinutes = 0 } = {}) {
  const text = clean(String(rawText || ''));
  const lower = text.toLowerCase().replace(/^(hey |hi |hello |ok |okay |light[,:]? )+/, '').replace(/^(please |kindly )/, '').replace(/ please$/, '');
  if (!lower) return { intent: 'empty', params: {} };
  let m;

  if (/^(help|commands?)$|\bwhat can you do\b|\bhow (do|can) i use\b|\bshow (me )?(your )?(commands|features)\b|\bwhat are your (commands|features)\b/.test(lower)) return { intent: 'help', params: {} };

  if ((m = lower.match(/^(?:remember|note|keep in mind)(?: that)?\s+(.{3,})$/))) return { intent: 'memory_save', params: { content: text.slice(text.length - m[1].length) } };

  // Reminders
  if (/^(?:remind me|set (?:a |an )?(?:new )?reminder|create (?:a |an )?(?:new )?reminder|add (?:a |an )?(?:new )?reminder|schedule (?:a |an )?reminder)\b/.test(lower)) {
    const body = text.replace(/^(?:remind me|set (?:a |an )?(?:new )?reminder|create (?:a |an )?(?:new )?reminder|add (?:a |an )?(?:new )?reminder|schedule (?:a |an )?reminder)\b/i, '').replace(/^\s*(?:to|about|that|for|of|:)\s+/i, '');
    const { when, rest, needsTime } = extractWhen(body, now, tzOffsetMinutes);
    const title = rest.replace(/^(?:to|about|that|for|of)\s+/i, '') || 'Reminder';
    return { intent: 'reminder_create', params: { title: title.slice(0, 300), remindAt: when, needsTime } };
  }
  if ((m = lower.match(/^(?:cancel|delete|remove|clear|stop)\s+(?:my |the |that )?reminders?\s*(?:about|for|to|called|named)?\s*(.*)$/))) {
    return { intent: 'reminder_cancel', params: { query: m[1].trim() } };
  }
  if (/\breminders?\b/.test(lower) && /\b(show|list|what|which|do i have|any|upcoming|my|view|see|check|are there|tell me)\b/.test(lower)) {
    return { intent: 'reminder_list', params: { overdue: /\boverdue|missed\b/.test(lower) } };
  }

  // Tasks
  if ((m = lower.match(/^(?:add|create|make|new|set up)\s+(?:a |an )?(?:new )?(?:task|todo|to-do)\s*(?:to|called|named|:|-)?\s*(.+)$/)) ||
      (m = lower.match(/^(?:add|put)\s+(.+?)\s+(?:to|on|onto)\s+(?:my |the )?(?:task list|tasks|to-?do list|todo list|to-?dos?)$/)) ||
      (m = lower.match(/^(?:i (?:need|have|want) to|don'?t let me forget to|task:?)\s+(.+)$/))) {
    const title = text.slice(text.toLowerCase().indexOf(m[1]), text.toLowerCase().indexOf(m[1]) + m[1].length) || m[1];
    const { when, rest } = extractWhen(title, now, tzOffsetMinutes);
    const priority = /\b(urgent|high priority|important)\b/i.test(title) ? 'high' : /\blow priority\b/i.test(title) ? 'low' : 'medium';
    const t = (rest || title).replace(/\b(high|low) priority\b/ig, '').replace(/\bby\s*$/i, '').replace(/\s+/g, ' ').trim();
    return { intent: 'task_create', params: { title: (t || title).slice(0, 300), dueAt: when, priority } };
  }
  if ((m = lower.match(/^(?:delete|remove|trash)\s+(?:the |my )?(?:task|todo|to-do)\s*(.*)$/))) return { intent: 'task_delete', params: { query: m[1].trim() } };
  if ((m = lower.match(/^(?:mark|set|complete|finish|finished|tick|check off|done with|i(?:'ve| have)? (?:finished|completed|done))\s+(?:task\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/)) &&
      !/\b(reminder|all tasks)\b/.test(lower)) {
    const q = m[1].replace(/^(?:the|my)\s+/, '').replace(/\s+(?:task|as)$/,'').trim();
    if (q) return { intent: 'task_complete', params: { query: q } };
  }
  if (/\b(tasks?|to-?do|todo|to-?dos)\b/.test(lower) && /\b(show|list|what|which|do i have|any|pending|open|my|view|see|check|outstanding|remaining|completed|done|finished|tell me|how many)\b/.test(lower)) {
    return { intent: 'task_list', params: { status: /\b(completed|done|finished)\b/.test(lower) && !/\b(not|undone|yet to be)\b/.test(lower) ? 'done' : 'open' } };
  }

  // Conversations
  if (/\b(new|start|begin|open)\b.*\b(conversation|chat)\b/.test(lower) && !/\b(delete|rename)\b/.test(lower)) return { intent: 'conversation_new', params: {} };

  // Date / time
  if (/\b(what(?:'s| is)?|tell me|give me|current|know)\b.*\btime\b|^time$|\btime (?:is it|now|right now)\b/.test(lower) && !/\bremind|task\b/.test(lower)) return { intent: 'time', params: {} };
  if (/\b(date|day of the week)\b/.test(lower) && /\b(what|today|tell me|current)\b/.test(lower) || /\bwhat day is (?:it|today)\b/.test(lower)) return { intent: 'date', params: {} };

  // Arithmetic
  try {
    const calc = calculate(lower);
    if (calc) return { intent: 'calculate', params: calc };
  } catch (e) {
    if (/\d/.test(lower) && /^[0-9+\-*/^().%\s=?]+$/.test(lower)) return { intent: 'calculate_error', params: { message: e.message } };
  }

  return { intent: 'unknown', params: { text } };
}

export const HELP_TEXT = [
  'Here is what I can do right now:',
  '• Time & date — "What time is it?", "What is today\'s date?"',
  '• Math — "12 times 4 plus 2", "15% of 240", "(3 + 4) * 5"',
  '• Tasks — "Add task buy milk", "Show my to-do list", "Mark buy milk as done", "Delete task buy milk" (asks you to confirm)',
  '• Reminders — "Remind me to call mom tomorrow at 5pm", "Remind me in 30 minutes to stretch", "Show my reminders", "Cancel reminder call mom"',
  '• Memory — "Remember that my passport expires in 2028"',
  '• Conversations — "Start a new conversation"',
  'Anything else needs an AI model provider, which is not connected yet.',
].join('\n');
