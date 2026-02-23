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
      defaultCurrency = "EGP",
      accounts = [],
      creditCards = [],
      loans = [],
      installments = [],
      categories = []
    } = req.body;

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    const text = message.toLowerCase();

    // ================= SMART MODEL ROUTING =================

    const clauseCount = (text.match(/ و | and /g) || []).length;
    const numbersCount = (text.match(/\d+/g) || []).length;

    const complexIntent =
      text.includes("credit") ||
      text.includes("كريدت") ||
      text.includes("قرض") ||
      text.includes("install") ||
      text.includes("حول") ||
      text.includes("transfer");

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

AVAILABLE ACCOUNTS:
${JSON.stringify(accounts)}

AVAILABLE CREDIT CARDS:
${JSON.stringify(creditCards)}

AVAILABLE LOANS:
${JSON.stringify(loans)}

AVAILABLE INSTALLMENTS:
${JSON.stringify(installments)}

AVAILABLE CATEGORIES:
${JSON.stringify(categories)}

CRITICAL RULES:

1) Use ONLY IDs from provided lists.
2) Generic verbs like "دفعت" do NOT imply obligation.
3) OBLIGATION_PAYMENT only if loan/installment explicitly matched.
4) Credit + amount = purchase.
5) Credit without amount OR settlement words = settlement.
6) Currency must be ISO 3-letter.

RETURN FORMAT:

{
  "actions": [
    {
      "action": "LOG_TRANSACTION | TRANSFER_FUNDS | OBLIGATION_PAYMENT",
      "type": "expense | income | transfer",
      "title": "string",
      "amount": number | null,
      "currency": "ISO_CODE | null",
      "categoryId": "UUID | null",
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

    let parsed = JSON.parse(raw.substring(firstBrace, lastBrace + 1));

    if (!parsed.actions || !Array.isArray(parsed.actions))
      return res.status(500).json({ error: "Invalid AI schema" });

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
};
