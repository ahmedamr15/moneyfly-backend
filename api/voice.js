export default async function handler(req, res) {
  try {
    // Allow only POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    // 🔒 Strict JSON schema instruction
    const systemPrompt = `
You are a financial transaction parser.

Extract structured data from the user message.

Return ONLY valid JSON.
Do NOT include explanations.
Do NOT include markdown.
Do NOT include extra text.

JSON format:
{
  "type": "income" | "expense" | "transfer",
  "amount": number,
  "category": string
}

Rules:
- If user gives money to another person → expense
- If money comes to user → income
- If between user's own accounts → transfer
- If unclear category → use "other"
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt },
                { text: message }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 200
          }
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({ error: "AI response invalid", raw: data });
    }

    const text = data.candidates[0].content.parts[0].text.trim();

    // Try parsing JSON safely
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: text
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error("VOICE API ERROR:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
}
