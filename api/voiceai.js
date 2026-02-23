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
    // 1️⃣ LLM INTENT PARSER (MULTI ACTION SUPPORT)
    // =====================================================

    const systemPrompt = `
You are a financial intent parser.

Return STRICT JSON only.
Support multiple actions.

Extract an array of actions.

Each action must include:
- intent (expense | income | transfer | obligation)
- amount (number or null)
- currency (ISO or null)
- title (short English, no numbers)
- rawSourceName
- rawDestinationName
- rawRelatedName
- mentionsCredit
- mentionsLoan
- mentionsInstallment
- confidence

Return format:

{
  "actions": [
    {
      "intent": "",
      "amount": null,
      "currency": null,
      "title": "",
      "rawSourceName": null,
      "rawDestinationName": null,
      "rawRelatedName": null,
      "mentionsCredit": false,
      "mentionsLoan": false,
      "mentionsInstallment": false,
      "confidence": 0.9
    }
  ]
}
`;

    async function callLLMChain() {
      const models = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3-32b",
        "llama-3.1-8b-instant"
      ];

      for (let model of models) {
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

          if (!response.ok) continue;
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content && content.includes("{")) {
            console.log("Model used:", model);
            return content;
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error("All LLMs failed");
    }

    function extractJSON(text) {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON found");
      return JSON.parse(match[0]);
    }

    const raw = await callLLMChain();
    const parsed = extractJSON(raw);

    if (!parsed.actions || !Array.isArray(parsed.actions))
      throw new Error("Invalid AI schema");

    // =====================================================
    // 2️⃣ DETERMINISTIC RESOLVER
    // =====================================================

    function matchByName(list, name) {
      if (!name) return null;
      const matches = list.filter(item =>
        item.name.toLowerCase().includes(name.toLowerCase())
      );
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return "AMBIGUOUS";
      return null;
    }

    function resolveCurrency(parsedCurrency, accountCurrency) {
      const map = {
        egp: "EGP",
        جنيه: "EGP",
        usd: "USD",
        دولار: "USD",
        eur: "EUR",
        يورو: "EUR",
        sar: "SAR",
        ريال: "SAR",
        aed: "AED",
        درهم: "AED",
        kwd: "KWD",
        qar: "QAR",
        omr: "OMR",
        bhd: "BHD"
      };
      if (!parsedCurrency) return accountCurrency;
      return map[parsedCurrency.toLowerCase()] || accountCurrency;
    }

    const finalActions = [];

    for (let item of parsed.actions) {
      const action = {
        action: null,
        type: null,
        title: item.title || "Transaction",
        amount: item.amount ? Math.abs(item.amount) : null,
        currency: null,
        categoryId: null,
        sourceAccountId: null,
        destinationAccountId: null,
        relatedId: null,
        requiresClarification: false,
        confidence: item.confidence || 0.9
      };

      // ========= TRANSFER =========
      if (item.intent === "transfer") {
        action.action = "TRANSFER_FUNDS";
        action.type = "transfer";

        const source = matchByName(accounts, item.rawSourceName);
        const dest = matchByName(accounts, item.rawDestinationName);

        if (source === "AMBIGUOUS" || dest === "AMBIGUOUS")
          action.requiresClarification = true;

        if (!source || !dest)
          action.requiresClarification = true;

        action.sourceAccountId = source?.id || null;
        action.destinationAccountId = dest?.id || null;

        const base = source?.currency || "EGP";
        action.currency = resolveCurrency(item.currency, base);
      }

      // ========= CREDIT =========
      else if (item.mentionsCredit) {
        let card =
          creditCards.length === 1
            ? creditCards[0]
            : defaultCreditCardId
            ? creditCards.find(c => c.id === defaultCreditCardId)
            : "AMBIGUOUS";

        if (!card || card === "AMBIGUOUS")
          action.requiresClarification = true;

        const settlement =
          text.includes("سدد") ||
          text.includes("statement") ||
          text.includes("due");

        if (!item.amount || settlement) {
          action.action = "TRANSFER_FUNDS";
          action.type = "transfer";
          action.sourceAccountId = defaultAccountId;
          action.destinationAccountId = card?.id || null;
        } else {
          action.action = "LOG_TRANSACTION";
          action.type = "expense";
          action.sourceAccountId = card?.id || null;
        }

        const base = card?.currency || "EGP";
        action.currency = resolveCurrency(item.currency, base);
      }

      // ========= LOAN / INSTALLMENT =========
      else if (item.mentionsLoan || item.mentionsInstallment) {
        const pool = [...loans, ...installments];
        const match = matchByName(pool, item.rawRelatedName);

        if (match === "AMBIGUOUS" || !match)
          action.requiresClarification = true;

        action.action = "OBLIGATION_PAYMENT";
        action.type = "expense";
        action.sourceAccountId = defaultAccountId;
        action.relatedId = match?.id || null;

        const base =
          accounts.find(a => a.id === defaultAccountId)?.currency || "EGP";

        action.currency = resolveCurrency(item.currency, base);
      }

      // ========= NORMAL EXPENSE / INCOME =========
      else {
        action.action = "LOG_TRANSACTION";
        action.type = item.intent === "income" ? "income" : "expense";

        if (action.type === "expense")
          action.sourceAccountId = defaultAccountId;
        else action.destinationAccountId = defaultAccountId;

        const base =
          accounts.find(a => a.id === defaultAccountId)?.currency || "EGP";

        action.currency = resolveCurrency(item.currency, base);
      }

      if (!action.amount && action.action !== "OBLIGATION_PAYMENT")
        action.requiresClarification = true;

      finalActions.push(action);
    }

    return res.status(200).json({ actions: finalActions });

  } catch (error) {
    return res.status(500).json({
      error: "VoiceAI crashed",
      message: error.message
    });
  }
};
