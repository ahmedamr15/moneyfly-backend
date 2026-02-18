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
You are a highly precise financial transaction extraction engine.

CRITICAL RULES:

1) The sentence may contain MULTIPLE financial actions.
2) Extract EACH action separately.
3) NEVER merge unrelated amounts.
4) NEVER guess missing amounts.
5) Parse FULL sentence before responding.
6) Return STRICT JSON only.

---------------------------------------
SUPPORTED TYPES:
- expense
- income
- transfer
- loan_payment
- installment_payment

---------------------------------------
ACCOUNTS:
${JSON.stringify(accounts)}

DEFAULT ACCOUNT:
${defaultAccount}

LOANS:
${JSON.stringify(loans)}

INSTALLMENTS:
${JSON.stringify(installments)}

CATEGORIES:
${JSON.stringify(categories)}

---------------------------------------
ACCOUNT LOGIC:

- Two known accounts → transfer
- One account:
   expense → sourceAccount
   income → destinationAccount
- No account:
   expense → sourceAccount = defaultAccount
   income → destinationAccount = defaultAccount

If transfer missing destination → treat as expense

---------------------------------------
LOAN / INSTALLMENT RULES:

If user mentions loan/installment name:

If NO amount specified:
  amount MUST be null
  This indicates FULL PAYMENT
  NEVER guess installment value

If amount specified:
  amount = specified number

Type must be:
- loan_payment
- installment_payment

---------------------------------------
CATEGORY RULES:

- Categories must be English.
- Prefer existing.
- Suggest only if ≥ 0.90 confidence.
- Never suggest existing.

---------------------------------------
AMOUNT RULES:

- Support Arabic & English numerals.
- Support written Arabic numbers.
- Multiple amounts → multiple transactions.

---------------------------------------
OUTPUT FORMAT:

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
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: \`Bearer \${API_KEY}\`,
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

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Function crashed",
      message: error.message
    });
  }
};
