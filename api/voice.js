// api/voice.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, accounts } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const prompt = `
You are a financial transaction parser.

Convert the following sentence into STRICT JSON.

Rules:
- Detect type: expense, income, or transfer.
- Extract total amount (sum multiple amounts if present).
- Detect category (food, transport, utilities, salary, shopping, other).
- If transfer between accounts, detect fromAccount and toAccount.
- If not transfer, leave fromAccount and toAccount null.
- Return ONLY valid JSON. No explanation text.

Sentence:
"${message}"

Available accounts:
${accounts ? accounts.join(", ") : "Not provided"}

JSON format:
{
  "type": "expense | income | transfer",
  "amount": number,
  "category": "food | transport | utilities | salary | shopping | other",
  "fromAccount": "string or null",
  "toAccount": "string or null"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-001:generateContent?key=" +
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

    const text = data.candidates[0].content.parts[0].text;

    try {
      const parsed = JSON.parse(text);
      return res.status(200).json(parsed);
    } catch (e) {
      return res.status(500).json({
        error: "AI returned invalid JSON",
        raw: text,
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
}
