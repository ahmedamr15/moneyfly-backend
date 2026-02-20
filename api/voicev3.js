export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST method" });

  try {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY)
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });

    const {
      message,
      assets = [],
      cards = [],
      loans = [],
      installments = [],
      categories = [],
      defaultAccountId = null,
      baseCurrency = "EGP"
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const systemPrompt = `
You are a STRICT and CONSERVATIVE financial action engine.
Return JSON only. No explanations.

---------------------------------------
ENTITIES

ASSETS:
${JSON.stringify(assets)}

CREDIT CARDS:
${JSON.stringify(cards)}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES (each has fixed type):
${JSON.stringify(categories)}

DEFAULT ACCOUNT ID:
${defaultAccountId}

BASE CURRENCY:
${baseCurrency}

---------------------------------------
GENERAL RULES

1) Each financial clause = one action.
2) Never merge unrelated numbers.
3) Never invent numbers.
4) Amount must always be positive.
5) If unsure → return REQUEST_CLARIFICATION.

---------------------------------------
ACCOUNT RULES

- If user says "credit" or "card"
  → ONLY match CREDIT CARDS.

- If bank name only mentioned
  → match ASSETS only.

- If no account mentioned:
    Expense → sourceAccountId = DEFAULT ACCOUNT ID
    Income → destinationAccountId = DEFAULT ACCOUNT ID

- Mentioning payment account is NOT transfer.

- Transfer ONLY if two ASSETS are clearly mentioned with transfer verbs.

---------------------------------------
CATEGORY RULES

1) Only choose from provided categories.
2) Each category has fixed type (expense or income).
3) Subcategory must belong to its parent.
4) If type conflicts with category.type → do NOT select it.
5) If unsure → categoryId = null and subcategoryId = null.

---------------------------------------
OBLIGATION RULES

If loan or installment name mentioned:
→ action = OBLIGATION_PAYMENT
→ relatedId = UUID
If no amount specified:
→ amount = null (means full payment)

---------------------------------------
CURRENCY RULES

If currency mentioned → use ISO code.
Else → use baseCurrency.

---------------------------------------
OUTPUT FORMAT

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | OBLIGATION_PAYMENT | REQUEST_CLARIFICATION",
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
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
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
      return res.status(500).json({ error: "Invalid AI response" });

    let cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "Invalid JSON returned by AI",
        raw: cleaned
      });
    }

    // -------------------------
    // SAFE NORMALIZATION LAYER
    // -------------------------

    parsed.actions = (parsed.actions || []).map(action => {

      if (typeof action.amount === "number") {
        action.amount = Math.abs(action.amount);
      }

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
}
