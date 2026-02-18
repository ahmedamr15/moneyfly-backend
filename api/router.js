module.exports = async function (req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {

    const body = req.body || {};
    const message = body.message;
    const accounts = body.accounts || [];
    const defaultAccount = body.defaultAccount || null;
    const categories = body.categories || {};

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    const systemPrompt = `
You are a HIGH-PRECISION financial transaction extraction engine.

CRITICAL EXECUTION RULES:

1) The sentence may contain MULTIPLE independent financial actions.
2) You MUST extract EACH action separately.
3) NEVER merge unrelated amounts.
4) NEVER ignore any numeric value.
5) If 3 amounts exist → return 3 transaction objects.
6) Parse the FULL sentence before responding.

SUPPORTED TYPES:
- expense
- income
- transfer (ONLY if internal between user accounts)

ACCOUNT RULES:

Available Accounts:
${JSON.stringify(accounts)}

Default Account:
${defaultAccount}

• If TWO known accounts appear → transfer
   sourceAccount = first mentioned
   destinationAccount = second mentioned

• If ONE known account appears:
   - If context is payment → expense (sourceAccount = mentioned)
   - If context is receiving → income (destinationAccount = mentioned)

• If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

• Saying "paid with CIB" is NOT transfer. It is expense using CIB.

CATEGORY RULES:

Existing Categories:
${JSON.stringify(categories)}

• Use closest existing category.
• Use closest existing subcategory.
• DO NOT suggest category/subcategory if already exists.
• If clearly new subcategory → return suggestion.
• If clearly new category → return suggestion.

TRANSFER CORRECTION RULE:
If transfer detected but:
   - only sourceAccount exists → treat as expense
   - only destinationAccount exists → treat as income

LANGUAGE:
Support Arabic & English.
Support Arabic digits & English digits.
Support written numbers.

STRICT OUTPUT:
Return ONLY valid JSON.
No markdown.
No explanation.
No comments.

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

    const aiResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          temperature: 0,
          response_format: { type: "json_object" }
        })
      }
    );

    const data = await aiResponse.json();

    if (data.error) {
      return res.status(400).json({
        error: "Groq API Error",
        details: data.error
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
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

    if (!parsed.transactions) parsed.transactions = [];
    if (!parsed.suggestion) parsed.suggestion = { category: null, subcategory: null };

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function Crashed",
      message: error.message
    });
  }
};
