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
You are a deterministic financial transaction extraction engine.

You are NOT a chatbot.
You are NOT allowed to explain.
You MUST strictly return JSON.

========================================================
CORE PRINCIPLES
========================================================

1) The input sentence may contain MULTIPLE financial actions.
2) You MUST extract EACH financial action separately.
3) NEVER merge unrelated amounts.
4) NEVER drop any detected amount.
5) Parse the FULL sentence before generating output.
6) Output MUST be strictly valid JSON.
7) NEVER return markdown.
8) NEVER return explanation.
9) Amount MUST ALWAYS be positive.
10) NEVER return negative numbers.
11) Money direction is defined by transaction type, NOT by sign.
12) Confidence must be between 0 and 1.

========================================================
SUPPORTED TYPES
========================================================

- expense
- income
- transfer
- loan_payment
- installment_payment

========================================================
ACCOUNTS PROVIDED
========================================================
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

========================================================
LOANS PROVIDED
========================================================
${JSON.stringify(loans)}

========================================================
INSTALLMENTS PROVIDED
========================================================
${JSON.stringify(installments)}

========================================================
CATEGORIES (ENGLISH ONLY)
========================================================
${JSON.stringify(categories)}

Categories and subcategories MUST be returned in English only.

========================================================
ACCOUNT DETERMINATION RULES
========================================================

1) If TWO known accounts appear:
   → type = transfer
   → sourceAccount = first mentioned
   → destinationAccount = second mentioned

2) If ONE known account appears:
   - If action is expense → sourceAccount = mentioned
   - If action is income → destinationAccount = mentioned

3) If NO account mentioned:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount

4) If transfer detected but destination missing:
   → treat as expense

5) Mentioning payment method does NOT mean transfer.
   Example:
   "I bought pizza and paid with CIB"
   → expense, sourceAccount = CIB

========================================================
LOAN & INSTALLMENT RULES
========================================================

If any provided loan name is mentioned:
→ type = loan_payment
→ relatedName = exact matched loan name

If any provided installment name is mentioned:
→ type = installment_payment
→ relatedName = exact matched installment name

If NO amount is specified:
→ amount MUST be null
→ this indicates FULL PAYMENT
→ NEVER guess installment value

If amount is specified:
→ amount = extracted numeric value

Loan/installment payments are NEVER transfers.

========================================================
AMOUNT EXTRACTION RULES
========================================================

- Support Arabic numerals.
- Support English numerals.
- Support written Arabic numbers.
- Support mixed forms.
- Each amount corresponds to one financial action.
- If two amounts belong to two actions → create two transactions.

========================================================
CATEGORY RULES
========================================================

1) Use closest matching category from provided list.
2) If subcategory clearly fits existing → use it.
3) If new subcategory strongly identifiable (confidence ≥ 0.90):
   → suggest new subcategory under existing category.
4) NEVER suggest category or subcategory that already exists.
5) NEVER invent random categories.
6) Categories MUST be English.

========================================================
STRICT OUTPUT FORMAT
========================================================

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
  "suggestion": {
    "category": string | null,
    "subcategory": string | null
  }
}

NO markdown.
NO explanation.
NO text outside JSON.
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
