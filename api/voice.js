export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, accounts = [], defaultAccount = null, categories = {} } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const prompt = `
You are a financial transaction parser.

Your job:
Convert the following speech into structured JSON transactions.

INPUT:
Speech: "${message}"

User Accounts:
${JSON.stringify(accounts)}

Default Account:
${defaultAccount}

Existing Categories & Subcategories:
${JSON.stringify(categories)}

RULES:

1) Extract ALL transactions mentioned.
2) Detect type:
   - expense
   - income
   - transfer

3) ACCOUNT LOGIC:

- If TWO accounts mentioned → transfer
  sourceAccount = first
  destinationAccount = second

- If ONE account mentioned:
   - expense → sourceAccount = mentioned
   - income → destinationAccount = mentioned

- If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

- Mentioning payment account is NOT transfer
  Example:
  "I bought pizza and paid with CIB"
  → expense, sourceAccount=CIB

4) Category Logic:
- Use closest matching category from existing list
- If subcategory missing but clearly identifiable → suggest new subcategory
- If category missing → suggest new category

5) IMPORTANT:
Return STRICT JSON only.
No markdown.
No explanation.
No backticks.

FORMAT:

{
  "transactions": [
    {
      "type": "expense | income | transfer",
      "amount": number,
      "category": string or null,
      "subcategory": string or null,
      "sourceAccount": string or null,
      "destinationAccount": string or null,
      "confidence": number
    }
  ],
  "suggestion": {
    "category": string or null,
    "subcategory": string or null
  }
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText = data.candidates[0].content.parts[0].text;

    // Remove markdown if any
    aiText = aiText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: aiText
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
