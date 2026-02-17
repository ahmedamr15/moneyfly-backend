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

  const systemPrompt = `
You are a deterministic financial transaction extraction engine.

Your task:
Extract ALL financial actions from the sentence.
The sentence MAY contain multiple transactions.

IMPORTANT RULES:

1) If there are multiple amounts → create multiple transaction objects.
2) NEVER merge different financial actions.
3) NEVER return empty transactions if financial amounts exist.
4) If sentence contains 2 amounts → output 2 transactions.
5) Parse the FULL sentence before responding.

SUPPORTED TYPES:
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
  sourceAccount = first
  destinationAccount = second

- If ONE known account mentioned:
   - expense → sourceAccount = mentioned
   - income → destinationAccount = mentioned

- If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

TRANSFER RULE:
If sentence says "from X to Y" and both X and Y are in accounts → transfer.
Otherwise treat as expense.

AMOUNT RULES:
- Support Arabic numbers (ألف، مئة، خمسين، خمسمية، إلخ)
- Support English numbers
- Extract EACH amount separately

STRICT OUTPUT:
Return JSON ONLY.
No markdown.
No explanation.
No text before or after JSON.

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

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: systemPrompt + "\n\nUser sentence:\n" + message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data?.candidates?.length) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText =
      data.candidates[0]?.content?.parts?.[0]?.text || "";

    // Remove markdown if exists
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

    // Prevent empty transactions if message clearly has numbers
    if (
      parsed.transactions &&
      parsed.transactions.length === 0 &&
      /\d|ألف|مئة|خمسين|مليون/.test(message)
    ) {
      return res.status(500).json({
        error: "AI returned empty transactions unexpectedly",
        raw: parsed
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
