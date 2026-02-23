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
    // SMART MODEL ROUTING
    // =====================================================

    const clauseCount = (text.match(/ و | and /g) || []).length;
    const numbersCount = (text.match(/\d+/g) || []).length;

    const complexIntent =
      text.includes("credit") ||
      text.includes("كريدت") ||
      text.includes("قرض") ||
      text.includes("install") ||
      text.includes("حول");

    let modelChain;

    if (clauseCount >= 2 || numbersCount >= 3) {
      modelChain = [
        "qwen/qwen3-32b",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant"
      ];
    } else if (complexIntent) {
      modelChain = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant"
      ];
    } else {
      modelChain = [
        "allam-2-7b",
        "llama-3.1-8b-instant"
      ];
    }

    const systemPrompt = `
You are a deterministic financial intent parser.

Return STRICT JSON only.
No explanation.
No markdown.

ALLOWED ACTION VALUES:
LOG_TRANSACTION
TRANSFER_FUNDS
OBLIGATION_PAYMENT

ALLOWED TYPE VALUES:
expense
income
transfer

TITLE RULES:
- Must be English
- Max 3 words
- No amounts
- No verbs like paid/bought/spent
- Examples: Chips, Netflix, Uber, Coffee, Credit Card Payment, Loan Payment, Transfer

Currency must be ISO 3-letter code (EGP, USD, EUR).

RETURN FORMAT:

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | TRANSFER_FUNDS | OBLIGATION_PAYMENT",
      "type": "expense | income | transfer",
      "title": "string",
      "amount": number | null,
      "currency": "ISO_CODE | null",
      "categoryId": "string | null",
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
`;

    async function callModel(model) {
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
            })
          }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;

      } catch {
        return null;
      }
    }

    let raw = null;

    for (let model of modelChain) {
      raw = await callModel(model);
      if (raw) break;
    }

    if (!raw)
      return res.status(500).json({ error: "All models failed" });

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1)
      return res.status(500).json({ error: "Malformed AI response" });

    let parsed;
    try {
      parsed = JSON.parse(raw.substring(firstBrace, lastBrace + 1));
    } catch {
      return res.status(500).json({ error: "Invalid JSON returned by AI" });
    }

    if (!parsed.actions || !Array.isArray(parsed.actions))
      return res.status(500).json({ error: "Invalid AI schema" });

    // =====================================================
    // NORMALIZATION & FINANCIAL LOGIC
    // =====================================================

    parsed.actions = parsed.actions.map(action => {

      if (typeof action.amount === "number")
        action.amount = Math.abs(action.amount);

      // ISO currency normalization
      if (action.currency) {
        const c = action.currency.toUpperCase();
        if (c.includes("EGP") || c.includes("جنيه")) action.currency = "EGP";
        else if (c.includes("USD") || c.includes("دولار")) action.currency = "USD";
        else if (c.includes("EUR") || c.includes("يورو")) action.currency = "EUR";
      }

      const settlementKeyword =
        text.includes("سدد") ||
        text.includes("مديون") ||
        text.includes("due") ||
        text.includes("settle");

      // CREDIT LOGIC
      if (action.mentionsCredit) {

        if (!action.amount || settlementKeyword) {
          action.action = "TRANSFER_FUNDS";
          action.type = "transfer";
          action.sourceAccountId = defaultAccountId;
          action.destinationAccountId = defaultCreditCardId;
          action.title = "Credit Card Payment";
        } else {
          action.action = "LOG_TRANSACTION";
          action.type = "expense";
          action.sourceAccountId = defaultCreditCardId;
          action.destinationAccountId = null;
        }
      }

      // EXPENSE fallback
      if (action.type === "expense" && !action.sourceAccountId)
        action.sourceAccountId = defaultAccountId;

      // INCOME fallback
      if (action.type === "income" && !action.destinationAccountId)
        action.destinationAccountId = defaultAccountId;

      // OBLIGATION fallback
      if (action.action === "OBLIGATION_PAYMENT") {
        action.type = "expense";
        if (!action.sourceAccountId)
          action.sourceAccountId = defaultAccountId;
      }

      // Title sanitizer
      if (!action.title) action.title = "Transaction";
      action.title = action.title.replace(/\d+/g, "").trim();
      if (action.title.length > 30)
        action.title = action.title.substring(0, 30);

      if (!action.confidence || action.confidence < 0.6)
        action.requiresClarification = true;

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
