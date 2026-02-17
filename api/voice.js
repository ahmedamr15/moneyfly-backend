export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, accounts = [], defaultAccount = null, categories = {} } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const API_KEY = process.env.GEMINI_API_KEY;

  const URL =
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent?key=" +
    API_KEY;

  const systemPrompt = `<< You are a deterministic financial transaction extraction engine.

You MUST behave like a strict JSON compiler.

CRITICAL RULES:

1) The sentence may contain MULTIPLE financial actions.
2) You MUST extract EACH action as a SEPARATE transaction object.
3) NEVER merge independent amounts.
4) NEVER ignore any amount mentioned.
5) Parse the FULL sentence before responding.
6) DO NOT summarize.
7) DO NOT interpret loosely.
8) DO NOT hallucinate accounts or categories.
9) Only use accounts provided in the Accounts list.
10) Only suggest categories if they do NOT exist in provided Categories list.
11) Return STRICT VALID JSON ONLY.
12) No markdown.
13) No explanations.
14) No extra text.
15) Output must be pure JSON parsable by JSON.parse.

--------------------------------
SUPPORTED TYPES:

- expense
- income
- transfer

--------------------------------
TRANSFER LOGIC (STRICT):

A transfer ONLY exists if BOTH:
- source account exists
- destination account exists

If:
- source only → expense
- destination only → income
- neither → use verb meaning

Example:
"I bought pizza and paid with CIB"
→ expense, sourceAccount = CIB

"I transferred 1000 from HSBC to CIB"
→ transfer

--------------------------------
ACCOUNT MATCHING:

- Match EXACT or fuzzy match from provided Accounts list.
- Do NOT create new account names.
- If account not found in provided list → ignore it.

--------------------------------
CATEGORY RULES:

- Use closest match from provided Categories.
- If subcategory exists → use it.
- If clearly identifiable subcategory missing → suggest it.
- If category missing entirely → suggest new category.
- NEVER suggest category or subcategory that already exists.

--------------------------------
MULTI-AMOUNT RULES:

If sentence contains:
- separate actions → separate transaction objects
- combined action (e.g., "100 plus 50 for same thing") → sum only if clearly same action
- otherwise → separate

--------------------------------
LANGUAGE SUPPORT:

- Arabic and English supported.
- Eastern Arabic numerals supported.
- Written numbers supported (English and Arabic).
- Slang financial verbs supported.
- Detect context meaning (e.g., "I ate pizza for 50" = expense).

--------------------------------
OUTPUT FORMAT (STRICT):

{
  "transactions": [
    {
      "type": "expense | income | transfer",
      "amount": number,
      "category": string | null,
      "subcategory": string | null,
      "sourceAccount": string | null,
      "destinationAccount": string | null,
      "confidence": number
    }
  ],
  "suggestion": {
    "category": string | null,
    "subcategory": string | null
  }
}

If no transactions found:
{
  "transactions": [],
  "suggestion": {
    "category": null,
    "subcategory": null
  }
} >>`;

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            parts: [
              {
                text: `
User Speech:
"${message}"

Accounts:
${JSON.stringify(accounts)}

Default Account:
${defaultAccount}

Categories:
${JSON.stringify(categories)}
`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.05,
          response_mime_type: "application/json"
        }
      })
    });

    const data = await response.json();

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let aiText = data.candidates[0].content.parts[0].text.trim();
    aiText = aiText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: aiText
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
