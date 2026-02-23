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

    // ================= SMART ROUTING =================

    const clauseCount = (text.match(/ و | and /g) || []).length;
    const numbersCount = (text.match(/\d+/g) || []).length;

    const hasComplexIntent =
      text.includes("credit") ||
      text.includes("كريدت") ||
      text.includes("قرض") ||
      text.includes("install") ||
      text.includes("حول");

    let modelChain = [];

    if (clauseCount >= 2 || numbersCount >= 3) {
      modelChain = [
        "qwen/qwen3-32b",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.1-8b-instant"
      ];
    } else if (hasComplexIntent) {
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
Extract:
action, type, title, amount, currency,
categoryId, sourceAccountId,
destinationAccountId, relatedId,
mentionsCredit, mentionsLoan, mentionsInstallment, confidence.
`;

    async function callModel(model) {
      try {
        const fetchPromise = fetch(
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

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 6000)
        );

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response || !response.ok) return null;

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
      return res.status(500).json({ error: "Malformed response" });

    let parsed;
    try {
      parsed = JSON.parse(raw.substring(firstBrace, lastBrace + 1));
    } catch {
      return res.status(500).json({ error: "Invalid JSON returned by AI" });
    }

    parsed.actions = (parsed.actions || []).map(action => {

      if (typeof action.amount === "number")
        action.amount = Math.abs(action.amount);

      const settlementKeyword =
        text.includes("سدد") ||
        text.includes("مديون") ||
        text.includes("due") ||
        text.includes("settle");

      // ===== CREDIT LOGIC =====
      if (action.mentionsCredit) {

        if (!action.amount || settlementKeyword) {
          action.action = "TRANSFER_FUNDS";
          action.type = "transfer";
          action.sourceAccountId = defaultAccountId;
          action.destinationAccountId = defaultCreditCardId;
          action.title = "Credit Settlement";
        } else {
          action.action = "LOG_TRANSACTION";
          action.type = "expense";
          action.sourceAccountId = defaultCreditCardId;
          action.destinationAccountId = null;
        }
      }

      // ===== EXPENSE =====
      if (action.type === "expense" && !action.sourceAccountId)
        action.sourceAccountId = defaultAccountId;

      // ===== INCOME =====
      if (action.type === "income" && !action.destinationAccountId)
        action.destinationAccountId = defaultAccountId;

      // ===== OBLIGATION =====
      if (action.action === "OBLIGATION_PAYMENT") {
        action.type = "expense";
        if (!action.sourceAccountId)
          action.sourceAccountId = defaultAccountId;
      }

      if (!action.title || action.title.length < 2)
        action.title = "Transaction";

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
