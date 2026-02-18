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
      defaultAccount = null,
      categories = {},
      loans = [],
      installments = []
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const systemPrompt = `
You are a highly precise financial transaction extraction engine.

CRITICAL RULES:

1) Sentence may contain MULTIPLE financial actions.
2) Extract EACH action separately.
3) NEVER merge unrelated amounts.
4) NEVER return negative amounts.
5) Amount MUST always be positive.
6) Type defines money direction.
7) Return STRICT JSON only.
8) Never return markdown or explanation.

SUPPORTED TYPES:
- expense
- income
- transfer
- loan_payment
- installment_payment

ACCOUNTS:
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES (English only):
${JSON.stringify(categories)}

ACCOUNT LOGIC:

- Two known accounts → transfer
- One account:
    expense → sourceAccount
    income → destinationAccount
- No account:
    expense → sourceAccount = defaultAccount
    income → destinationAccount = defaultAccount

If transfer missing destination → treat as expense.

LOAN / INSTALLMENT RULES:

If loan/installment name mentioned:

- If NO amount specified:
    amount MUST be null
    This means FULL PAYMENT.

- If amount specified:
    amount = specified number.

Use:
- loan_payment
- installment_payment

relatedName MUST equal matched loan/installment name.

CATEGORY RULES:

- Categories must be English.
- Prefer existing categories.
- Suggest only if confidence >= 0.90.
- Never suggest existing categories.

AMOUNT RULES:

- Support Arabic and English numbers.
- Support written Arabic numbers.
- Multiple amounts → multiple transactions.

OUTPUT FORMAT:

{
  "transactions": [
    {
      "type": "expense | income | transfer | loan_payment | installment_payment",
      "amount": number | null,
      "category": string | null,
      "subcategory": string | null,
      "sourceAccount": string | null,
      "destinationAccount": string | null,
      "relatedName": string | null,
      "confidence": number
    }
  ],
  "detectedLoans": [
    { "name": string, "amount": number | null }
  ],
  "detectedInstallments": [
    { "name": string, "amount": number | null }
  ],
  "suggestion": {
    "category": string | null,
    "subcategory": string | null
  }
}
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

    // =============================
    // NORMALIZATION LAYER
    // =============================

    parsed.transactions = (parsed.transactions || []).map(tx => {

      // 1️⃣ Make amount positive
      if (typeof tx.amount === "number") {
        tx.amount = Math.abs(tx.amount);
      }

      // 2️⃣ Fix direction

      if (tx.type === "income") {
        tx.sourceAccount = null;
        if (!tx.destinationAccount)
          tx.destinationAccount = defaultAccount || null;
      }

      if (tx.type === "expense") {
        tx.destinationAccount = null;
        if (!tx.sourceAccount)
          tx.sourceAccount = defaultAccount || null;
      }

      if (tx.type === "transfer") {
        if (!tx.sourceAccount)
          tx.sourceAccount = defaultAccount || null;
      }

      if (tx.type === "loan_payment" || tx.type === "installment_payment") {
        if (!tx.sourceAccount)
          tx.sourceAccount = defaultAccount || null;
      }

      return tx;
    });

    // 3️⃣ Confidence Filter
    parsed.transactions = parsed.transactions.filter(tx => tx.confidence >= 0.7);

    // 4️⃣ Suggestion filter
    if (
      parsed.suggestion &&
      parsed.suggestion.category &&
      parsed.suggestion.confidence &&
      parsed.suggestion.confidence < 0.9
    ) {
      parsed.suggestion = { category: null, subcategory: null };
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
};
