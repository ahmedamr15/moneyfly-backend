export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const prompt = `
You are an advanced financial transaction parser.

Your task is to convert natural language into structured financial transactions.

The input may be Arabic or English.
The input may contain multiple financial events.

----------------------------------------------------
CORE RULE
----------------------------------------------------

Determine money direction:

- Money leaves user → expense
- Money enters user → income
- Money moves between user accounts → transfer

Understand meaning semantically.
Do NOT rely only on verbs.

----------------------------------------------------
CATEGORY SYSTEM
----------------------------------------------------

Available categories:

{
  "food": ["pizza","coffee","restaurant","lunch","dinner"],
  "utilities": ["electricity","water","internet"],
  "shopping": ["clothes","shoes","electronics"],
  "transport": ["uber","taxi","gas"],
  "salary": ["salary"],
  "other": []
}

If new subcategory detected, suggest it.

----------------------------------------------------
OUTPUT FORMAT (STRICT JSON)
----------------------------------------------------

{
  "transactions": [
    {
      "type": "income | expense | transfer",
      "amount": number,
      "category": string,
      "subcategory": string | null,
      "confidence": number
    }
  ],
  "suggestion": {
    "category": string | null,
    "subcategory": string | null
  }
}

Return JSON only.
No markdown.
No explanation.

MESSAGE:
"${message}"
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data,
      });
    }

    let text = data.candidates[0].content.parts[0].text;

    // Remove markdown if model added it
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      const parsed = JSON.parse(text);
      return res.status(200).json(parsed);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: text,
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: "Server crashed",
      details: error.message,
    });
  }
}
