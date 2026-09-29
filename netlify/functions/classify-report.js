// POST { text, reportType, vehicle, route } -> { result, model }
// Uses OpenAI structured outputs so the model must return the JSON contract,
// never free-form paragraphs. The browser falls back to its on-device
// classifier if this function errors or times out.

const SCHEMA = {
  name: 'transit_report_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'subcategory', 'component', 'title', 'issue', 'condition', 'priority', 'department', 'summary', 'safety_review_required', 'confidence'],
    properties: {
      category: { type: 'string', enum: ['vehicle_defect', 'facilities', 'safety', 'operations', 'other'] },
      subcategory: { type: 'string', description: 'snake_case, e.g. passenger_door, brakes, broken_glass+trash, passenger_conduct' },
      component: { type: 'string', description: 'Vehicle system or stop amenity, e.g. "Rear Passenger Door", "Bus Shelter"' },
      title: { type: 'string', description: '2-4 word queue label, e.g. "Rear door"' },
      issue: { type: 'string', description: 'Short statement of the problem' },
      condition: { type: 'string', description: 'Observed condition, e.g. "Intermittent failure to close"' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      department: { type: 'string', enum: ['maintenance', 'facilities', 'safety', 'operations', 'supervisor'] },
      summary: { type: 'string', description: 'One sentence, factual, no speculation' },
      safety_review_required: { type: 'boolean' },
      confidence: { type: 'number' },
    },
  },
};

const SYSTEM = `You structure bus operator reports for a transit agency's operations team.
Rules:
- Classify only what the operator reported. Do not invent facts, causes, or repairs.
- vehicle_defect -> maintenance. Stop/shelter conditions (trash, glass, graffiti, lighting, signs, stop damage) -> facilities.
- Passenger conduct, injuries, medical, security, fire/smoke -> category safety, department supervisor, priority high unless clearly minor.
- Detours, blocked stops, construction, lateness -> operations.
- priority high: brakes, steering, tires, doors failing to close, accessibility equipment failing, any safety incident.
  medium: warning lamps, mirrors, wipers, lighting, broken glass. low: cosmetic, HVAC comfort, graffiti, routine trash.
- Never state or imply whether a bus is safe to operate. Set safety_review_required=true when a supervisor or maintenance person should review.
- confidence is 0..1.`;

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
  const text = String(body.text || '').slice(0, 2000);
  if (!text.trim()) return Response.json({ error: 'text is required' }, { status: 400 });

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Report type selected by operator: ${body.reportType || 'unknown'}\nBus: ${body.vehicle || 'unknown'}\nRoute: ${body.route || 'unknown'}\nOperator said: """${text}"""`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return Response.json({ error: 'AI request failed', status: res.status, detail: detail.slice(0, 500) }, { status: 502 });
  }
  const data = await res.json();
  try {
    const result = JSON.parse(data.choices[0].message.content);
    return Response.json({ result, model });
  } catch {
    return Response.json({ error: 'Model returned invalid JSON' }, { status: 502 });
  }
};
