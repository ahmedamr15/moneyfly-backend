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
You are a STRICT FINANCIAL EXECUTION ENGINE.
Return JSON ONLY.

---------------------------------------
CRITICAL RULE: UUID ONLY

You MUST return ONLY IDs exactly as provided.
NEVER return names.
NEVER return strings.
If unsure → return REQUEST_CLARIFICATION.

---------------------------------------
ASSETS:
${JSON.stringify(assets)}

CREDIT_CARDS:
${JSON.stringify(cards)}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES:
${JSON.stringify(categories)}

DEFAULT_ACCOUNT_ID:
${defaultAccountId}

BASE_CURRENCY:
${baseCurrency}

---------------------------------------
CLAUSE RULE

Split sentence into independent financial clauses.
Each clause must produce one action.
Amounts MUST NOT leak between clauses.

---------------------------------------
ACCOUNT RULES

If "credit", "card", "visa", "mastercard" appears:
→ You MUST match ONLY from CREDIT_CARDS.
→ Ignore ASSETS completely.

If transfer verb appears AND two ASSETS mentioned:
→ transfer

If no account mentioned:
Expense → sourceAccountId = DEFAULT_ACCOUNT_ID
Income → destinationAccountId = DEFAULT_ACCOUNT_ID

---------------------------------------
OBLIGATION RULE

If loan/installment mentioned:
→ action = OBLIGATION_PAYMENT
If no amount in same clause:
→ amount = null

---------------------------------------
CATEGORY RULE

Each category has fixed type.
You MUST match by ID.
If unsure → categoryId = null.

---------------------------------------
CONFIDENCE RULE

Base confidence = 0.5
+0.2 exact account match
+0.2 category match
+0.1 currency detected
Max 0.95
Never return 1.0

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
  model: "qwen/qwen3-32b",
  temperature: 0.1,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: message }
  ]
})
      }
    );

    const data = await response.json();

    if (data.error)
      return res.status(400).json({ error: "Groq API Error", details: data.error });

    const raw = data.choices?.[0]?.message?.content;
    if (!raw)
      return res.status(500).json({ error: "Invalid AI response" });

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

    // -----------------------------
    // STRICT VALIDATION LAYER
    // -----------------------------

    const validIds = new Set([
      ...assets.map(a => a.id),
      ...cards.map(c => c.id),
      ...loans.map(l => l.id),
      ...installments.map(i => i.id),
      ...categories.map(c => c.categoryId),
      ...categories.flatMap(c => c.subcategories.map(s => s.id))
    ]);

    for (const action of parsed.actions || []) {
      const idsToCheck = [
        action.sourceAccountId,
        action.destinationAccountId,
        action.categoryId,
        action.subcategoryId,
        action.relatedId
      ].filter(Boolean);

      for (const id of idsToCheck) {
        if (!validIds.has(id)) {
          return res.status(500).json({
            error: "AI returned non-UUID entity",
            invalidId: id
          });
        }
      }

      if (action.confidence >= 1.0) {
        action.confidence = 0.95;
      }
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
}
