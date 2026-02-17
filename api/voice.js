export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    message,
    accounts = [],
    defaultAccount = null,
    categories = {},
    autoExecuteThreshold = 0.9
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const systemPrompt = `
You are a HIGH-PRECISION financial transaction extraction engine.

CRITICAL RULES:

1) The user sentence MAY contain MULTIPLE financial actions.
2) You MUST extract EACH financial action as a SEPARATE transaction.
3) NEVER merge unrelated amounts.
4) NEVER ignore any number.
5) If sentence contains 3 separate financial actions → output 3 objects.

TRANSACTION TYPES:
- expense
- income
- transfer (ONLY if clearly internal between user accounts)

ACCOUNTS AVAILABLE:
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

CATEGORIES AVAILABLE:
${JSON.stringify(categories)}

ACCOUNT LOGIC:

- If TWO known accounts mentioned → transfer
- If ONE known account mentioned:
    expense → sourceAccount = mentioned
    income → destinationAccount = mentioned
- If NO account mentioned:
    expense → sourceAccount = defaultAccount
    income → destinationAccount = defaultAccount

IMPORTANT:
Mentioning payment method (e.g., "paid with CIB") is NOT transfer.

TRANSFER RULES:
- If both source AND destination exist → transfer
- If only source exists → expense
- If only destination exists → income

CATEGORY RULES:
- Use closest matching existing category/subcategory
- ONLY suggest new category/subcategory if NOT already existing
- Do NOT suggest existing ones

LANGUAGE:
- Support Arabic and English
- Support written numbers and numeric digits

STRICT OUTPUT RULES:
- Return STRICT JSON
- NO markdown
- NO explanation
- NO backticks

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

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-3-12b",
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();

    if (!data?.choices?.[0]?.message?.content) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText = data.choices[0].message.content.trim();

    // Remove accidental markdown
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
      error: "Internal server error",
      details: error.message
    });
  }
}
