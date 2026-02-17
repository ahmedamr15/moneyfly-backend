export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const prompt = `
You are a financial voice transaction parser.

Return ONLY valid JSON in this exact format:

{
  "type": "expense | income | transfer",
  "amount": number,
  "category": "string",
  "confidence": number
}

Rules:
- Detect transaction type (expense, income, transfer)
- Extract total amount (sum if multiple numbers exist)
- Choose category from: food, transport, utilities, shopping, salary, entertainment, health, education, other
- confidence must be between 0 and 1
- DO NOT return any text outside JSON

User message:
"${message}"
`;

    async function callGemini(prompt) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
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

        if (response.status === 503 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        return await response.json();
      }
    }

    const data = await callGemini(prompt);

    const aiText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!aiText) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch (err) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: aiText,
      });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
