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
      defaultAccountId = null,
      defaultCreditCardId = null,
      accounts = [],
      creditCards = [],
      loans = [],
      installments = [],
      categories = []
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const systemPrompt = `
You are a STRICT deterministic financial action extraction engine.

You are NOT a chatbot.
You NEVER explain.
You NEVER add text outside JSON.
You ONLY return structured JSON.

====================================================
CORE RESPONSIBILITY

Convert user voice input into structured financial actions.

You MUST:
- Split multiple financial actions.
- Never merge unrelated numbers.
- Never invent entities.
- Never guess when multiple entities exist.
- Return UUIDs only (never names).
- Always return currency.
- Respect entity ambiguity strictly.

====================================================
AVAILABLE ENTITIES

ACCOUNTS:
${JSON.stringify(accounts)}

CREDIT CARDS:
${JSON.stringify(creditCards)}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES:
${JSON.stringify(categories)}

DEFAULT ACCOUNT:
${defaultAccountId}

DEFAULT CREDIT CARD:
${defaultCreditCardId}

====================================================
ENTITY RULES

1) If user mentions an entity clearly → return its exact UUID.
2) If entity mentioned generically:
   - credit → set mentionsCredit = true
   - loan → set mentionsLoan = true
   - installment → set mentionsInstallment = true
3) If multiple entities exist and user does not specify clearly:
   - NEVER choose randomly.
   - Return null ID and set the correct mention flag.
4) If only one entity exists → return its UUID directly.
5) Never fabricate IDs.
6) Never assign a bank account when the user clearly refers to credit.

====================================================
TYPE RULES

Income:
- destinationAccountId must be filled if known.
- sourceAccountId must be null.

Expense:
- If specific account identified → assign it.
- If no account mentioned → sourceAccountId may be null.
- Do NOT automatically fallback to defaultAccountId inside this engine.

Transfer:
- Both sourceAccountId and destinationAccountId must be filled.
- If one side missing → treat as expense.

Loan / Installment:
- action = OBLIGATION_PAYMENT
- relatedId must be filled if clearly identified.
- If mentioned generically → relatedId = null and set mention flag.

====================================================
ACCOUNT OVERRIDE RULE (CRITICAL)

If the user mentions "credit" generically
AND does NOT clearly specify which credit card
THEN:

- mentionsCredit = true
- sourceAccountId MUST be null
- NEVER fallback to defaultAccountId
- NEVER assign any bank account
- NEVER choose a random credit card

Only assign sourceAccountId if a specific credit card UUID is clearly matched.

====================================================
AMBIGUITY HANDLING

If:
- Multiple credit cards exist and none specified → return mentionsCredit = true and null ID.
- Multiple loans exist and none specified → return mentionsLoan = true and null relatedId.
- Multiple installments exist and none specified → return mentionsInstallment = true and null relatedId.

Never resolve ambiguity by guessing.

====================================================
AMOUNT RULES

- Extract all monetary values.
- Never reuse the same amount for multiple unrelated actions.
- If obligation mentioned without amount → amount = null.
- Amount must always be positive.

====================================================
OUTPUT FORMAT (STRICT)

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | OBLIGATION_PAYMENT | TRANSFER",
      "type": "expense | income | transfer | null",
      "amount": number | null,
      "currency": "string",
      "categoryId": "string | null",
      "subcategoryId": "string | null",
      "sourceAccountId": "string | null",
      "destinationAccountId": "string | null",
      "relatedId": "string | null",
      "mentionsCredit": boolean,
      "mentionsLoan": boolean,
      "mentionsInstallment": boolean,
      "confidence": number
    }
  ]
}

Return JSON only.
No markdown.
No explanation.
No text outside JSON.
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

    let cleaned = raw.trim();

    // Extra safety strip (in case model leaks reasoning)
    if (cleaned.startsWith("<")) {
      cleaned = cleaned.substring(cleaned.indexOf("{"));
    }

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

    parsed.actions = (parsed.actions || []).map(action => {

      // Force positive amounts
      if (typeof action.amount === "number") {
        action.amount = Math.abs(action.amount);
      }

      // Guarantee booleans
      action.mentionsCredit = !!action.mentionsCredit;
      action.mentionsLoan = !!action.mentionsLoan;
      action.mentionsInstallment = !!action.mentionsInstallment;

      // Guarantee confidence
      if (typeof action.confidence !== "number") {
        action.confidence = 0.5;
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
