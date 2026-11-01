import { claimDueReminders } from './reminders.js';
import { purgeExpiredSessions } from './sessionStore.js';

let timer;
let cleanup;
let running = false;

/** Every 15s: atomically move due reminders to 'triggered'. Browsers then confirm delivery. */
export function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await claimDueReminders();
      if (n) console.log(`[scheduler] ${n} reminder(s) triggered`);
    } catch (e) { console.error('[scheduler] tick failed:', e.message); }
    finally { running = false; }
  };
  tick();
  timer = setInterval(tick, 15_000);
  cleanup = setInterval(() => purgeExpiredSessions().catch((e) => console.error('[sessions] purge failed:', e.message)), 60 * 60_000);
  timer.unref(); cleanup.unref();
}

export function stopScheduler() { clearInterval(timer); clearInterval(cleanup); }
