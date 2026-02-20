module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST method" });

  try {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) throw new Error("Missing GROQ_API_KEY");

    const {
      message,
      accounts = [],
      creditCards = [],
      defaultAccountId = null,
      categories = [],
      loans = [],
      installments = [],
      baseCurrency = "EGP"
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const systemPrompt = `
You are a deterministic financial ACTION ENGINE.

You are NOT a chatbot.
You NEVER explain.
You NEVER add text outside JSON.
You ONLY return valid JSON.

--------------------------------------------------
SUPPORTED ACTIONS:

- LOG_TRANSACTION
- OBLIGATION_PAYMENT
- REQUEST_CLARIFICATION
- QUERY_STATE

--------------------------------------------------
IMPORTANT RULES:

1) Sentence may contain multiple financial actions.
2) Each action MUST produce one object.
3) Never ignore any number.
4) Never invent numbers.
5) Amount must always be positive.
6) Currency may differ from base currency (${baseCurrency}).
7) NEVER return names — ONLY UUIDs.

--------------------------------------------------
ACCOUNTS (Assets):
${JSON.stringify(accounts)}

CREDIT CARDS:
${JSON.stringify(creditCards)}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES:
${JSON.stringify(categories)}

DEFAULT ACCOUNT ID:
${defaultAccountId}

--------------------------------------------------
ACCOUNT RULES:

If expense and no account mentioned:
→ sourceAccountId = DEFAULT ACCOUNT ID

If income and no account mentioned:
→ destinationAccountId = DEFAULT ACCOUNT ID

If credit card mentioned:
→ treat as expense
→ sourceAccountId = creditCard.id

Mentioning payment account is NOT transfer.

Transfer ONLY if two asset accounts mentioned.

--------------------------------------------------
LOAN / INSTALLMENT RULES:

If loan or installment mentioned:
→ action = OBLIGATION_PAYMENT
→ relatedId = UUID
If no amount specified:
→ amount = null (means full due)

--------------------------------------------------
CURRENCY RULES:

If currency mentioned:
→ include "currency" field (ISO code)
Else:
→ currency = "${baseCurrency}"

--------------------------------------------------
OUTPUT FORMAT (STRICT):

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | OBLIGATION_PAYMENT | QUERY_STATE | REQUEST_CLARIFICATION",
      "type": "expense | income | transfer | null",
      "amount": number | null,
      "currency": string,
      "categoryId": string | null,
      "subcategoryId": string | null,
      "sourceAccountId": string | null,
      "destinationAccountId": string | null,
      "relatedId": string | null,
      "confidence": number
    }
  ]
}

Return JSON only.
No markdown.
No explanation.
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: \`Bearer \${API_KEY}\`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        error: "Groq API Error",
        details: data.error
      });
    }

    const raw = data.choices?.[0]?.message?.content;
    if (!raw)
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });

    let cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: cleaned
      });
    }

    // -------------------------------
    // NORMALIZATION LAYER (Safe)
    // -------------------------------

    parsed.actions = (parsed.actions || []).map(action => {

      if (typeof action.amount === "number") {
        action.amount = Math.abs(action.amount);
      }

      // default fallback protection
      if (action.action === "LOG_TRANSACTION") {

        if (action.type === "expense") {
          action.destinationAccountId = null;
          if (!action.sourceAccountId)
            action.sourceAccountId = defaultAccountId;
        }

        if (action.type === "income") {
          action.sourceAccountId = null;
          if (!action.destinationAccountId)
            action.destinationAccountId = defaultAccountId;
        }

        if (action.type === "transfer") {
          if (!action.sourceAccountId)
            action.sourceAccountId = defaultAccountId;
        }
      }

      if (action.action === "OBLIGATION_PAYMENT") {
        if (!action.sourceAccountId)
          action.sourceAccountId = defaultAccountId;
      }

      return action;
    });

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
};
