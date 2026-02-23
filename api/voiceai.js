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

    const text = message.toLowerCase();

    // =====================================================
    // 🧠 SMART TIER ROUTING
    // =====================================================

    const clauseCount = (text.match(/ و | and /g) || []).length;
    const numbersCount = (text.match(/\d+/g) || []).length;

    const hasCredit =
      text.includes("credit") ||
      text.includes("كريدت") ||
      text.includes("بطاقة");

    const hasLoan =
      text.includes("قرض") ||
      text.includes("loan");

    const hasInstallment =
      text.includes("قسط") ||
      text.includes("install");

    const hasTransfer =
      text.includes("حول") ||
      text.includes("transfer") ||
      text.includes("نقل");

    let modelChain = [];

    // Tier 3 – Complex
    if (clauseCount >= 2 || numbersCount >= 3) {
      modelChain = [
        "qwen/qwen3-32b",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant"
      ];
    }
    // Tier 2 – Structured
    else if (hasCredit || hasLoan || hasInstallment || hasTransfer) {
      modelChain = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant"
      ];
    }
    // Tier 1 – Simple
    else {
      modelChain = [
        "allam-2-7b",
        "llama-3.1-8b-instant"
      ];
    }

    // =====================================================
    // 🧾 STRICT SYSTEM PROMPT V3
    // =====================================================

    const systemPrompt = `
You are a deterministic Financial Action Engine.

Return STRICT JSON ONLY.
No explanation.
No markdown.
No comments.

DEFAULT_ACCOUNT_ID:
${defaultAccountId}

DEFAULT_CREDIT_CARD_ID:
${defaultCreditCardId}

ACCOUNTS:
${JSON.stringify(accounts)}

CREDIT_CARDS:
${JSON.stringify(creditCards)}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES:
${JSON.stringify(categories)}

SUPPORTED ACTIONS:
LOG_TRANSACTION
OBLIGATION_PAYMENT
TRANSFER_FUNDS

RULES:

1) Split into independent clauses.
2) NEVER merge amounts.
3) NEVER invent numbers.
4) Amount must be positive.
5) Use ONLY provided UUIDs.
6) Expense → destinationAccountId MUST be null.
7) Income → sourceAccountId MUST be null.
8) Transfer → both source and destination required.
9) OBLIGATION_PAYMENT → type MUST be "expense".
10) TITLE RULE:
   - Must represent purchased item or payment target.
   - NEVER generic verbs like "دفعت".
   - Credit payment → "Credit Card Payment".
   - Transfer → "Transfer".
11) Confidence max 1.0.

STRICT OUTPUT FORMAT:

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | OBLIGATION_PAYMENT | TRANSFER_FUNDS",
      "type": "expense | income | transfer",
      "title": "string",
      "amount": number | null,
      "currency": "ISO_CODE | null",
      "categoryId": "UUID | null",
      "subcategoryId": "UUID | null",
      "sourceAccountId": "UUID | null",
      "destinationAccountId": "UUID | null",
      "relatedId": "UUID | null",
      "mentionsCredit": boolean,
      "mentionsLoan": boolean,
      "mentionsInstallment": boolean,
      "confidence": number
    }
  ]
}
`;

    // =====================================================
    // 🚀 SAFE MODEL CALL WITH FALLBACK
    // =====================================================

    async function callModel(model) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model,
              temperature: 0,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
              ]
            }),
            signal: controller.signal
          }
        );

        clearTimeout(timeout);

        if (!response.ok) throw new Error("Model failed");

        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
      } catch (err) {
        clearTimeout(timeout);
        return null;
      }
    }

    let raw = null;

    for (let model of modelChain) {
      raw = await callModel(model);
      if (raw) {
        console.log("Model used:", model);
        break;
      }
    }

    if (!raw)
      return res.status(500).json({ error: "All models failed" });

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1)
      return res.status(500).json({ error: "Malformed AI response" });

    let parsed = JSON.parse(raw.substring(firstBrace, lastBrace + 1));

    // =====================================================
    // 🔒 HARD VALIDATION LAYER
    // =====================================================

    parsed.actions = (parsed.actions || []).map(action => {

      if (typeof action.amount === "number") {
        action.amount = Math.abs(action.amount);
      }

      if (action.action === "OBLIGATION_PAYMENT") {
        action.type = "expense";
      }

      if (action.type === "expense") {
        action.destinationAccountId = null;
      }

      if (action.mentionsCredit && defaultCreditCardId) {
        action.sourceAccountId = defaultCreditCardId;
      }

      if (!action.confidence || action.confidence < 0.6) {
        action.requiresClarification = true;
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
