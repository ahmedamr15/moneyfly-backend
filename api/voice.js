// استبدلنا export default بـ module.exports
module.exports = async function (req, res) {

if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

const {
message,
accounts = [],
defaultAccount = null,
categories = {}
} = req.body;

if (!message) {
return res.status(400).json({ error: "Message is required" });
}

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

  const prompt = `
You are a strict financial transaction extraction engine.

You MUST return ONLY valid JSON.
No markdown.
No explanations.
No backticks.
No extra text.

--------------------------------
CRITICAL RULES:

1) The sentence may contain MULTIPLE financial actions.
2) Extract EACH action as a SEPARATE transaction object.
3) NEVER merge independent amounts.
4) NEVER ignore any number.
5) Parse the FULL sentence before responding.
6) Only use accounts from provided list.
7) Only suggest new category/subcategory if not already in provided categories.
8) Do NOT hallucinate accounts or categories.

--------------------------------
TRANSACTION TYPES:
- expense
- income
- transfer

--------------------------------
TRANSFER LOGIC:

- If BOTH source and destination accounts are mentioned → transfer.
- If ONLY source mentioned → expense.
- If ONLY destination mentioned → income.
- If no account mentioned → use defaultAccount depending on type.

--------------------------------
INPUT DATA:

Speech:
"${message}"

Accounts:
${JSON.stringify(accounts)}

Default Account:
${defaultAccount}

Categories:
${JSON.stringify(categories)}

--------------------------------
RETURN FORMAT (STRICT JSON):

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

If no transaction found:
{
  "transactions": [],
  "suggestion": {
    "category": null,
    "subcategory": null
  }
}
`;

  try {

    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.05
        }
      })
    });
    
try {
const response = await fetch(URL, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
contents: [{ parts: [{ text: prompt }] }],
generationConfig: {
temperature: 0.1,
response_mime_type: "application/json"
}
})
});

const data = await response.json();

if (!data.candidates || !data.candidates[0].content.parts[0].text) {
return res.status(500).json({ error: "AI Error", raw: data });
}

const aiText = data.candidates[0].content.parts[0].text.trim();
return res.status(200).json(JSON.parse(aiText));

} catch (error) {
return res.status(500).json({ error: "Server Error", details: error.message });
}
};

