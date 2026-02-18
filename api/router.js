module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) throw new Error("Missing GROQ_API_KEY");

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
You are a financial transaction extraction engine.

CRITICAL RULES:

1) The sentence may contain MULTIPLE financial actions.
2) Extract EACH action as a separate transaction object.
3) NEVER merge unrelated amounts.
4) NEVER ignore any numeric value.
5) Parse the FULL sentence before responding.

TRANSACTION TYPES:
- expense
- income
- transfer (ONLY if internal between user accounts)

ACCOUNT LOGIC:

Available accounts:
${JSON.stringify(accounts)}

Default account:
${defaultAccount}

Rules:
- If TWO accounts mentioned → transfer
  sourceAccount = first
  destinationAccount = second

- If ONE account mentioned:
   - expense → sourceAccount = mentioned
   - income → destinationAccount = mentioned

- If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

- Mentioning payment account is NOT transfer.
Example:
"I bought pizza and paid with CIB"
→ expense, sourceAccount=CIB

TRANSFER SPECIAL RULE:
- If transfer has source but no destination → treat as expense.
- If transfer has destination but no source → treat as income.

CATEGORY RULES:

Existing categories & subcategories:
${JSON.stringify(categories)}

- Always prefer an EXISTING category if context matches.
- NEVER invent generic categories like "expenses" or "transactions".
- Only suggest new category/subcategory if it does NOT exist.
- Categories and subcategories MUST be returned in ENGLISH only.
- Even if input is Arabic, translate classification to English.

AMOUNT RULES:
- Support Arabic and English numbers.
- Separate different financial actions.
- Do NOT combine unrelated numbers.

RETURN STRICT JSON ONLY.
NO markdown.
NO explanation.
NO extra text.

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

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: "Groq API Error", details: data.error });
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: "Invalid AI response", raw: data });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: content
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function Crashed",
      message: error.message
    });
  }
};
