// POST { question, snapshot } -> { answer, ticket_ids }
// Answers operations questions strictly from the live snapshot the browser
// sends. The browser falls back to its built-in answers if this fails.

const SCHEMA = {
  name: 'copilot_answer',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'ticket_ids'],
    properties: {
      answer: { type: 'string', description: 'Plain-language answer, at most 5 short sentences.' },
      ticket_ids: { type: 'array', items: { type: 'string' }, description: 'Ticket IDs referenced, most important first (max 6).' },
    },
  },
};

const SYSTEM = `You are the AI Operations Copilot for a transit agency's operations team (demo system).
Answer ONLY from the JSON snapshot provided. If the data doesn't answer the question, say so.
Be direct and specific: name buses, stops, ticket IDs, ages and owners.
Never state or imply that a bus is safe to operate or repaired; that requires a qualified person.
Never give emergency instructions beyond "follow existing SMART safety procedures".`;

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
  const question = String(body.question || '').slice(0, 500);
  if (!question.trim()) return Response.json({ error: 'question is required' }, { status: 400 });
  const snapshot = JSON.stringify(body.snapshot || {}).slice(0, 24000);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Snapshot:\n${snapshot}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!res.ok) return Response.json({ error: 'AI request failed', status: res.status }, { status: 502 });
  const data = await res.json();
  try {
    return Response.json(JSON.parse(data.choices[0].message.content));
  } catch {
    return Response.json({ error: 'Model returned invalid JSON' }, { status: 502 });
  }
};
