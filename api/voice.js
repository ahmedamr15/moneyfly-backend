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
You are NOT a chatbot.
You are a strict financial transaction compiler.

You must follow a strict deterministic pipeline.

========================================
STEP 1 — READ FULL SENTENCE
========================================
The input may contain multiple financial actions.
You MUST split them logically before extracting.

Never stop at the first action.
Never merge unrelated actions.

========================================
STEP 2 — DETECT ACTION TYPE
========================================

Allowed types ONLY:
- expense
- income
- transfer
- loan_payment
- installment_payment

TYPE DECISION TREE (STRICT):

1) If sentence contains a known LOAN name → loan_payment
2) If sentence contains a known INSTALLMENT name → installment_payment
3) If sentence contains:
   قبضت / استلمت / جالي / received / got
   → income
4) If sentence contains:
   حولت من X إلى Y (both known accounts)
   → transfer
5) If sentence contains:
   دفعت / اشتريت / صرفت / paid / bought
   → expense
6) If transfer detected but only ONE account → expense
7) Never classify income as transfer unless BOTH accounts exist.

========================================
STEP 3 — ACCOUNT RESOLUTION (STRICT)

ACCOUNTS:
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

Rules:

INCOME:
- destinationAccount = detected account OR defaultAccount
- sourceAccount MUST be null

EXPENSE:
- sourceAccount = detected account OR defaultAccount
- destinationAccount MUST be null

TRANSFER:
- sourceAccount = first account
- destinationAccount = second account
- If second missing → convert to expense

LOAN/INSTALLMENT:
- relatedName = exact matched name
- accounts follow expense logic
- amount rules apply

========================================
STEP 4 — AMOUNT EXTRACTION (STRICT)

Rules:
1) Amount MUST ALWAYS be positive.
2) NEVER return negative numbers.
3) If written Arabic numbers:
   مية = 100
   ميتين = 200
   ألف = 1000
   ألفين = 2000
   خمسين = 50
   ثلاثين = 30
   etc.
4) If multiple amounts in separate actions → separate transactions.
5) If loan/installment mentioned without number → amount = null
6) Never guess missing amounts.

========================================
STEP 5 — CATEGORY RULES

CATEGORIES (English only):
${JSON.stringify(categories)}

Rules:
- Categories must be English.
- Prefer exact subcategory match.
- If "chips" → snacks (not new category).
- If existing category fits → use it.
- Suggest ONLY if confidence ≥ 0.90 AND not already existing.

========================================
STEP 6 — VALIDATION BEFORE OUTPUT

Before returning JSON:

- No negative amounts.
- Income must have destinationAccount only.
- Expense must have sourceAccount only.
- Transfer must have both accounts.
- Loan/installment must include relatedName.
- Never leave both source and destination null unless income without account.

========================================
OUTPUT FORMAT (STRICT JSON ONLY)

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
