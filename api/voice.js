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
You are a STRICT deterministic financial transaction extraction engine.

You are NOT a chatbot.
You do NOT explain.
You do NOT summarize.
You do NOT interpret loosely.
You only extract structured financial actions.

--------------------------------------------------
ABSOLUTE RULES (MUST FOLLOW 100%):

1) The sentence may contain MULTIPLE financial actions.
2) You MUST extract EVERY monetary action.
3) NEVER ignore any number.
4) NEVER merge unrelated numbers.
5) NEVER invent numbers.
6) NEVER change numbers.
7) Amount MUST ALWAYS be positive.
8) NEVER return negative numbers.
9) Transaction type defines direction, NOT sign.
10) Parse the FULL sentence before responding.
11) Return STRICT JSON ONLY.
12) No markdown.
13) No explanation.
14) No extra keys.

--------------------------------------------------
SUPPORTED TRANSACTION TYPES:

- expense
- income
- transfer
- loan_payment
- installment_payment

--------------------------------------------------
ACCOUNTS (exact match only):
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

LOANS (exact name match only):
${JSON.stringify(loans)}

INSTALLMENTS (exact name match only):
${JSON.stringify(installments)}

CATEGORIES (English only):
${JSON.stringify(categories)}

--------------------------------------------------
STEP 1 — SPLIT LOGIC:

Before generating output:
Mentally split the sentence into independent financial clauses.
Each clause that contains a financial action MUST become one transaction.

If 5 actions exist → return 5 transactions.
Never return fewer than actual actions.

--------------------------------------------------
STEP 2 — AMOUNT RULES:

- Extract ALL numbers.
- Support Arabic numerals (١٢٣٤٥٦٧٨٩٠).
- Support English numerals (1234567890).
- Support written Arabic numbers (خمسة، ثلاثين، ألفين…).
- If two numbers are linked to two different items → two transactions.
- Never reuse a number for two actions.

--------------------------------------------------
STEP 3 — TYPE DETECTION:

Income keywords (Arabic or English):
قبضت، جالي، استلمت، دخل، received, salary
→ type = income

Expense keywords:
دفعت، اشتريت، صرفت، سددت، أكلت، حجزت
→ type = expense

Transfer keywords:
حولت، نقلت
→ type = transfer ONLY if two valid accounts are detected.

--------------------------------------------------
STEP 4 — ACCOUNT LOGIC:

Case A: Two valid accounts detected
→ transfer
sourceAccount = first
destinationAccount = second

Case B: One account detected
If expense → sourceAccount = account
If income → destinationAccount = account

Case C: No account detected
If expense → sourceAccount = DEFAULT ACCOUNT
If income → destinationAccount = DEFAULT ACCOUNT

IMPORTANT:
Mentioning payment account is NOT a transfer.
Example:
"اشتريت بيتزا ودفعت من CIB"
→ expense, NOT transfer.

If transfer detected but destination missing
→ treat as expense.

--------------------------------------------------
STEP 5 — LOAN / INSTALLMENT LOGIC:

If a LOAN name is mentioned:
→ type = loan_payment
→ relatedName = matched loan name

If an INSTALLMENT name is mentioned:
→ type = installment_payment
→ relatedName = matched installment name

If NO amount specified:
→ amount = null
→ This means FULL PAYMENT
→ NEVER guess installment value

If amount specified:
→ amount = extracted number

Loan/installment detection overrides expense classification.

--------------------------------------------------
STEP 6 — CATEGORY LOGIC:

- Categories MUST be English.
- Subcategories MUST be English.
- Prefer existing categories/subcategories.
- If item clearly fits existing subcategory → use it.
- DO NOT create new subcategory if similar existing one exists.
  Example:
  "chips" should map to "snacks" if snacks exists.
- Suggest ONLY if:
   1) Confidence >= 0.90
   2) Category/subcategory NOT already in list

If not confident → category = null

--------------------------------------------------
STEP 7 — INCOME / EXPENSE ACCOUNT DIRECTION STRICTNESS:

Income:
- destinationAccount MUST be filled
- sourceAccount MUST be null

Expense:
- sourceAccount MUST be filled
- destinationAccount MUST be null

Transfer:
- both accounts MUST be filled

Loan/installment:
- sourceAccount MUST follow expense logic
- destinationAccount MUST be null

--------------------------------------------------
OUTPUT FORMAT (STRICT):

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

--------------------------------------------------
FINAL CHECK BEFORE OUTPUT:

- Count numbers in sentence.
- Count transactions generated.
- They MUST logically match.
- If mismatch → regenerate internally before returning.

Return JSON only.
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
