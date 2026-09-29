// POST { audio: base64, mimeType } -> { text }
// Used when the browser has no built-in live speech recognition.

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'OPENAI_API_KEY not set' }, { status: 503 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.audio) return Response.json({ error: 'audio is required' }, { status: 400 });

  const mime = body.mimeType || 'audio/webm';
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const bytes = Buffer.from(body.audio, 'base64');
  if (bytes.length > 8 * 1024 * 1024) return Response.json({ error: 'Recording too long' }, { status: 413 });

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `report.${ext}`);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  form.append('language', 'en');
  form.append('prompt', 'Transit operator report. Terms: SMART, FAST, Woodward, Gratiot, Van Dyke, Dequindre, Mound, Hamtramck, shelter, farebox, kneeling, ramp, Mile Road.');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) return Response.json({ error: 'Transcription failed', status: res.status }, { status: 502 });
  const data = await res.json();
  return Response.json({ text: data.text || '' });
};
