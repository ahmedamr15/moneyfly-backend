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
You are a high-precision financial transaction extraction engine.

This system is used in a real banking application.
Accuracy is critical.

==============================
CORE RULES
==============================

1) The input may contain MULTIPLE financial actions.
2) Each financial action MUST be extracted as a SEPARATE transaction object.
3) NEVER merge separate actions.
4) NEVER ignore any detected monetary amount.
5) If 3 distinct amounts → return 3 transaction objects.
6) Parse the ENTIRE sentence before responding.

==============================
TRANSACTION TYPES
==============================

- expense
- income
- transfer (ONLY internal between user accounts)

==============================
ACCOUNTS AVAILABLE
==============================

${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

ACCOUNT RULES:

1) If TWO known accounts mentioned → transfer
2) If ONE account mentioned:
   - expense → sourceAccount = mentioned
   - income → destinationAccount = mentioned
3) If no account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount
4) Mentioning payment method is NOT transfer.
5) If transfer keyword used but only one valid account → treat based on meaning.

==============================
AMOUNT RULES
==============================

- Detect numeric and written numbers.
- Arabic and English supported.
- Multiple distinct actions → multiple transactions.
- "100 plus 50 on same item" → single 150.
- Separate actions → separate objects.

==============================
CATEGORIES AVAILABLE
==============================

${JSON.stringify(categories)}

CATEGORY RULES:

1) Match best existing category/subcategory.
2) Suggest ONLY if missing.
3) If category exists but subcategory missing → suggest subcategory only.
4) If neither exists → suggest both.
5) Never suggest already existing category/subcategory.

==============================
CONFIDENCE RULE
==============================

> 0.90 high confidence
0.75–0.89 medium
< 0.75 low

Be conservative.

==============================
STRICT OUTPUT RULE
==============================

Return STRICT JSON ONLY.
No explanation.
No markdown.
No backticks.

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

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data?.choices?.[0]?.message?.content) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText = data.choices[0].message.content;

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
