// /api/sms.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST method" });

  try {
    const { text } = req.body;

    if (!text)
      return res.status(400).json({ error: "SMS text is required" });

    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY)
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });

    const systemPrompt = `
You are a deterministic financial SMS parser.

Return STRICT JSON only.

Supported intents:
- expense
- income
- unknown

Extract:

{
  "intent": "expense | income | unknown",
  "amount": number | null,
  "currency": string | null,
  "merchant": string | null,
  "cardLast4": string | null,
  "date": string | null,
  "requiresClarification": boolean,
  "confidence": number
}

Rules:

- "was charged" = expense
- "credited" = income
- If currency not found, return null
- If amount not found, return null
- cardLast4 = digits after #
- Merchant = text after "at"
- Convert date/time to ISO if possible
- If critical fields missing → requiresClarification = true
- Never add explanations outside JSON
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
          ]
        })
      }
    );

    if (!response.ok)
      return res.status(500).json({ error: "LLM request failed" });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match)
      return res.status(500).json({ error: "Invalid LLM output" });

    const parsed = JSON.parse(match[0]);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "SMS parser crashed",
      message: error.message
    });
  }
}
