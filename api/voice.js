module.exports = async function (req, res) {
  // ===== CORS =====
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
    } = req.body || {};

    if (!message)
      return res.status(400).json({ error: "Message is required" });

    // ================= SYSTEM PROMPT =================

    const systemPrompt = `
You are a highly precise financial transaction extraction engine.

CRITICAL EXECUTION RULES:

You MUST follow these rules strictly. If any rule conflicts, follow the order below.

HIGHEST PRIORITY RULES (cannot be broken):

1) Amount MUST ALWAYS be a positive number.
2) NEVER return negative amounts under any circumstance.
3) Transaction type defines money direction, NOT the sign.
4) For income:
   - destinationAccount MUST be filled.
   - sourceAccount MUST be null.
5) For expense:
   - sourceAccount MUST be filled.
   - destinationAccount MUST be null.
6) For transfer:
   - BOTH sourceAccount AND destinationAccount MUST be filled.
7) If only ONE account is detected:
   - expense → sourceAccount = detected account
   - income → destinationAccount = detected account
8) If NO account detected:
   - expense → sourceAccount = defaultAccount
   - income → destinationAccount = defaultAccount
9) If installment or loan detected:
   - type MUST be installment_payment or loan_payment
   - relatedName MUST contain exact matched name
   - If no amount → amount = null (full payment)

STRUCTURE RULES:

10) The sentence may contain MULTIPLE financial actions.
11) Extract EACH action separately.
12) NEVER merge unrelated amounts.
13) NEVER ignore any amount.
14) Parse the FULL sentence before generating output.
15) Return STRICT JSON only.
16) NEVER return markdown or explanations.

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

CATEGORIES (English only):
${JSON.stringify(categories)}

---------------------------------------
ACCOUNT LOGIC:

- If TWO known accounts → transfer
- If ONE account:
    expense → sourceAccount
    income → destinationAccount
- If NO account:
    expense → sourceAccount = defaultAccount
    income → destinationAccount = defaultAccount

If transfer missing destination → treat as expense.

---------------------------------------
LOAN / INSTALLMENT RULES:

If user mentions loan/installment name:

- If NO amount specified:
    amount MUST be null
    This indicates FULL PAYMENT
    NEVER guess installment value

- If amount specified:
    amount = specified number

Type must be:
- loan_payment
- installment_payment

relatedName must contain the matched loan/installment name.

---------------------------------------
CATEGORY RULES:

- Categories and subcategories MUST be English.
- Prefer existing categories.
- Suggest ONLY if confidence >= 0.90.
- Never suggest existing categories/subcategories.

---------------------------------------
AMOUNT RULES:

- Support Arabic & English numerals.
- Support written Arabic numbers.
- Multiple amounts → multiple transactions.
- Never merge separate actions.

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

    // ================= GROQ CALL =================

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
          response_format: { type: "json_object" }, // يمنع markdown
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

    const raw = data?.choices?.[0]?.message?.content;

    if (!raw) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let parsed;

    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw
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
