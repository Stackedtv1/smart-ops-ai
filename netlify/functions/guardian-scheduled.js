// Scheduled Guardian check: runs every minute whether or not anyone has the app open.
import { runLiveSweep } from '../lib/guardianLive.js';

export default async () => {
  try {
    const r = await runLiveSweep();
    console.log('[guardian]', JSON.stringify(r));
  } catch (e) {
    console.error('[guardian] failed', e.message);
  }
};

export const config = { schedule: '* * * * *' };
