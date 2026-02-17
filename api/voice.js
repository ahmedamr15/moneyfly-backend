export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, language, defaultAccount, accounts, currency } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Missing text input" });
    }

    const prompt = `
You are a strict financial transaction parser.

Return ONLY valid JSON.
Do NOT return explanations.
Do NOT wrap in markdown.
Do NOT add comments.

User Text:
"${text}"

Language: ${language}
Default Account: ${defaultAccount}
Available Accounts: ${accounts?.join(", ") || "None"}
Currency: ${currency}

Instructions:
- Detect transaction type: expense, income, transfer
- Extract ALL amounts mentioned
- If multiple amounts exist, return an array of transactions
- If one amount exists, return a single transaction object
- Detect category (food, transport, utilities, salary, shopping, entertainment, health, other)
- If income and no category mentioned → category = "other"
- If transfer but destination is not internal account → classify as expense
- If multiple numbers (e.g. 20 and 30) → sum them OR return array (prefer array)

Response format:

{
  "transactions": [
    {
      "type": "expense",
      "amount": 50,
      "category": "food",
      "account": "${defaultAccount}",
      "currency": "${currency}",
      "confidence": 0.95
    }
  ]
}

If parsing fails:
{
  "error": "Could not determine transaction"
}
`;

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512
          }
        })
      }
    );

    const data = await geminiResponse.json();

    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({ error: "AI response invalid" });
    }

    const aiText = data.candidates[0].content.parts[0].text.trim();

    try {
      const parsedJSON = JSON.parse(aiText);
      return res.status(200).json(parsedJSON);
    } catch (err) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: aiText
      });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
