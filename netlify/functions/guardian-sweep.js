// POST /.netlify/functions/guardian-sweep — run a Guardian check now.
import { runLiveSweep } from '../lib/guardianLive.js';

export default async () => {
  try {
    return Response.json(await runLiveSweep());
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
};
