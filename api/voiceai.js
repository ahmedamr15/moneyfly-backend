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

    // =====================================================
    // 🧠 INTELLIGENT MODEL ROUTER (Cost Optimization)
    // =====================================================

    const text = message.toLowerCase();

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

    const isComplex =
      clauseCount > 1 ||
      numbersCount > 1 ||
      hasCredit ||
      hasLoan ||
      hasInstallment ||
      hasTransfer;

    const selectedModel = isComplex
      ? "qwen/qwen3-32b"
      : "llama-3.1-8b-instant";

    console.log("Selected model:", selectedModel);

    // =====================================================
    // 🧾 STRICT GLOBAL SYSTEM LANGUAGE (GSL)
    // =====================================================

    const systemPrompt = `
You are a deterministic Financial Action Engine.

You are NOT a chatbot.
You do NOT explain.
You do NOT add thoughts.
You return STRICT JSON ONLY.

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

1) Split sentence into independent financial clauses.
2) Each clause = one action.
3) NEVER merge amounts.
4) NEVER invent numbers.
5) Amount must always be positive.
6) Use ONLY UUIDs from provided lists.
7) NEVER return names.
8) If account unspecified:
   - Expense → DEFAULT_ACCOUNT_ID
   - Income → DEFAULT_ACCOUNT_ID
9) If "credit" mentioned:
   - If one card → use it
   - If multiple & defaultCreditCardId exists → use it
   - If ambiguous → sourceAccountId = null and mentionsCredit = true
10) Loan/installment:
   - If one match → use relatedId
   - If multiple → relatedId = null and flag mention
11) Currency:
   - Detect if stated (USD, EGP, EUR etc.)
   - Otherwise assume account currency
12) Confidence:
   Base 0.5
   +0.2 exact UUID match
   +0.2 exact category match
   +0.1 clear intent
   Max 1.0

STRICT OUTPUT FORMAT:

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | OBLIGATION_PAYMENT | TRANSFER_FUNDS",
      "type": "expense | income | transfer | null",
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

Return JSON only.
No markdown.
No explanation.
No extra keys.
`;

    // =====================================================
    // 🚀 CALL LLM
    // =====================================================

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
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

    if (!raw) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    // =====================================================
    // 🔒 ROBUST JSON EXTRACTION (Removes <think>)
    // =====================================================

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      return res.status(500).json({
        error: "AI did not return JSON structure",
        raw: raw
      });
    }

    let cleaned = raw.substring(firstBrace, lastBrace + 1);

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "AI returned malformed JSON",
        raw: cleaned
      });
    }

    // =====================================================
    // 🔧 NORMALIZATION LAYER
    // =====================================================

    parsed.actions = (parsed.actions || []).map(action => {

      if (typeof action.amount === "number") {
        action.amount = Math.abs(action.amount);
      }

      if (action.type === "expense" && !action.sourceAccountId) {
        action.sourceAccountId = defaultAccountId || null;
      }

      if (action.type === "income" && !action.destinationAccountId) {
        action.destinationAccountId = defaultAccountId || null;
      }

      if (action.action === "OBLIGATION_PAYMENT" && !action.sourceAccountId) {
        action.sourceAccountId = defaultAccountId || null;
      }

      return action;
    });

    // Confidence filter
    parsed.actions = parsed.actions.filter(a => a.confidence >= 0.6);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
};
