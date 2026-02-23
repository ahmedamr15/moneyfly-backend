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
      defaultAccountId = null,          // for income + obligations
      defaultPaymentMethodId = null,    // NEW: for purchases
      accounts = [],
      creditCards = [],
      loans = [],
      installments = [],
      categories = []
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const text = message.toLowerCase();

    // ===============================
    // LLM PROMPT
    // ===============================

    const systemPrompt = `
You are a financial intent parser.
Return STRICT JSON only.
Support multiple actions.

Each action must include:

intent: expense | income | transfer | obligation
amount: number or null
currency: ISO or null
title: short English title (max 3 words, no numbers)
rawSourceName
rawDestinationName
rawRelatedName
rawCategoryName
mentionsCredit
mentionsLoan
mentionsInstallment
confidence

Return:
{ "actions": [ ... ] }
`;

    async function callLLM(model) {
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

    async function callLLMChain() {
      const models = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3-32b",
        "llama-3.1-8b-instant"
      ];

      for (let model of models) {
        const result = await callLLM(model);
        if (result && result.includes("{")) {
          console.log("Model used:", model);
          return result;
        }
      }
      throw new Error("All models failed");
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

    // ===============================
    // HELPERS
    // ===============================

    function matchByName(list, name) {
      if (!name) return null;
      const matches = list.filter(item =>
        item.name.toLowerCase().includes(name.toLowerCase())
      );
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return "AMBIGUOUS";
      return null;
    }

    function resolveCurrency(parsedCurrency, baseCurrency) {
      const map = {
        egp: "EGP",
        usd: "USD",
        eur: "EUR",
        sar: "SAR",
        aed: "AED",
        kwd: "KWD",
        qar: "QAR",
        omr: "OMR",
        bhd: "BHD"
      };
      if (!parsedCurrency) return baseCurrency;
      return map[parsedCurrency.toLowerCase()] || baseCurrency;
    }

    function resolveCategory(rawCategoryName) {
      if (!rawCategoryName) return null;

      const exact = categories.find(
        c => c.name.toLowerCase() === rawCategoryName.toLowerCase()
      );
      if (exact) return exact.id;

      const partial = categories.find(c =>
        rawCategoryName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (partial) return partial.id;

      const other = categories.find(
        c => c.name.toLowerCase() === "other"
      );
      return other ? other.id : null;
    }

    const finalActions = [];

    for (let item of parsed.actions) {
      const action = {
        action: null,
        type: null,
        title: (item.title || "Transaction").replace(/\d+/g, "").trim(),
        amount: item.amount ? Math.abs(item.amount) : null,
        currency: null,
        categoryId: null,
        sourceAccountId: null,
        destinationAccountId: null,
        relatedId: null,
        requiresClarification: false,
        confidence: item.confidence || 0.9
      };

      // =====================
      // TRANSFER
      // =====================
      if (item.intent === "transfer") {
        action.action = "TRANSFER_FUNDS";
        action.type = "transfer";

        const source = matchByName(accounts, item.rawSourceName);
        const dest = matchByName(accounts, item.rawDestinationName);

        if (!source || !dest || source === "AMBIGUOUS" || dest === "AMBIGUOUS")
          action.requiresClarification = true;

        action.sourceAccountId = source?.id || null;
        action.destinationAccountId = dest?.id || null;

        const base = source?.currency || "EGP";
        action.currency = resolveCurrency(item.currency, base);
      }

      // =====================
      // LOAN / INSTALLMENT
      // =====================
      else if (item.mentionsLoan || item.mentionsInstallment) {
        const pool = [...loans, ...installments];
        const match = matchByName(pool, item.rawRelatedName);

        if (!match || match === "AMBIGUOUS")
          action.requiresClarification = true;

        action.action = "OBLIGATION_PAYMENT";
        action.type = "expense";
        action.sourceAccountId = defaultAccountId;
        action.relatedId = match?.id || null;

        const base =
          accounts.find(a => a.id === defaultAccountId)?.currency || "EGP";

        action.currency = resolveCurrency(item.currency, base);
      }

      // =====================
      // NORMAL EXPENSE / INCOME
      // =====================
      else {
        action.action = "LOG_TRANSACTION";
        action.type = item.intent === "income" ? "income" : "expense";

        // ===== INCOME =====
        if (action.type === "income") {
          action.destinationAccountId = defaultAccountId;
          action.currency = resolveCurrency(
            item.currency,
            accounts.find(a => a.id === defaultAccountId)?.currency || "EGP"
          );
        }

        // ===== EXPENSE PURCHASE (NEW ENGINE) =====
        else {
          const explicit = matchByName(
            [...accounts, ...creditCards],
            item.rawSourceName
          );

          if (explicit && explicit !== "AMBIGUOUS") {
            action.sourceAccountId = explicit.id;
          }

          else if (item.mentionsCredit) {

            if (creditCards.length === 1) {
              action.sourceAccountId = creditCards[0].id;
            }
            else if (
              defaultPaymentMethodId &&
              creditCards.some(c => c.id === defaultPaymentMethodId)
            ) {
              action.sourceAccountId = defaultPaymentMethodId;
            }
            else {
              action.requiresClarification = true;
            }
          }

          else if (defaultPaymentMethodId) {
            action.sourceAccountId = defaultPaymentMethodId;
          }

          else {
            action.requiresClarification = true;
          }

          const baseAccount =
            accounts.find(a => a.id === action.sourceAccountId) ||
            creditCards.find(c => c.id === action.sourceAccountId);

          action.currency = resolveCurrency(
            item.currency,
            baseAccount?.currency || "EGP"
          );
        }
      }

      // FX Protection
      if (
        action.action === "TRANSFER_FUNDS" &&
        action.sourceAccountId &&
        action.destinationAccountId
      ) {
        const sourceAcc = accounts.find(a => a.id === action.sourceAccountId);
        const destAcc = accounts.find(a => a.id === action.destinationAccountId);
        if (sourceAcc && destAcc && sourceAcc.currency !== destAcc.currency) {
          action.requiresClarification = true;
        }
      }

      // CATEGORY
      if (action.action === "LOG_TRANSACTION") {
        action.categoryId = resolveCategory(item.rawCategoryName);
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
