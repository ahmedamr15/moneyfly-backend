export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    message,
    accounts = [],
    defaultAccount = null,
    categories = {}
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {

    const systemPrompt = `
You are a financial transaction extraction engine.

CRITICAL RULES:

1) The user sentence may contain MULTIPLE financial actions.
2) You MUST extract EACH financial action as a SEPARATE transaction object.
3) NEVER merge separate actions.
4) NEVER ignore any amount.
5) If sentence contains 3 financial actions → output 3 transactions.
6) Analyze the FULL sentence before responding.

TRANSACTION TYPES:
- expense
- income
- transfer (ONLY if internal between user accounts)

ACCOUNTS AVAILABLE:
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

CATEGORIES AVAILABLE:
${JSON.stringify(categories)}

ACCOUNT LOGIC:

- If TWO accounts mentioned → transfer
  sourceAccount = first
  destinationAccount = second

- If ONE account mentioned:
   - If expense → sourceAccount = mentioned
   - If income → destinationAccount = mentioned

- If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

IMPORTANT:
- Mentioning payment method is NOT transfer.
  Example:
  "I bought pizza and paid with CIB"
  → expense, sourceAccount = CIB

TRANSFER RULES:
- If transfer but missing destination → treat as expense
- If transfer but missing source → treat as income

AMOUNT RULES:
- Support Arabic & English numbers.
- Extract ALL amounts.
- If "20 on pizza and 30 on coffee" → two separate transactions.
- If "200 plus 300" in SAME action → sum only if clearly same action.

CATEGORY RULES:
- Match closest existing category.
- If subcategory missing but clear → suggest subcategory.
- If category missing → suggest new category.
- Do NOT invent unrelated categories.

RETURN STRICT JSON ONLY.
NO explanation.
NO markdown.
NO backticks.

FORMAT:

{
  "transactions": [
    {
      "type": "expense | income | transfer",
      "amount": number,
      "category": string | null,
      "subcategory": string | null,
      "sourceAccount": string | null,
      "destinationAccount": string | null,
      "confidence": number
    }
  ],
  "suggestion": {
    "category": string | null,
    "subcategory": string | null
  }
}
`;

    async function callGemini() {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" +
          process.env.GEMINI_API_KEY,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: systemPrompt.replace('${message}', message) }]
              }
            ]
          })
        }
      );

      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        return callGemini();
      }

      return response.json();
    }

    const data = await callGemini();

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText = data.candidates[0].content.parts[0].text;

    // Clean markdown if returned
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
