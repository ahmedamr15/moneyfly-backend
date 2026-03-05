export default async function handler(req, res) {
try {
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “POST, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

```
if (req.method === "OPTIONS") return res.status(200).end();
if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

const { imageBase64, ocrText } = req.body;

if (!imageBase64 || !ocrText) {
  return res.status(400).json({ error: "imageBase64 and ocrText are required" });
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  return res.status(500).json({ error: "Gemini API key not configured" });
}

const prompt = `You are a receipt reconstruction engine.
```

You are given BOTH the receipt image AND raw OCR text.
Use the IMAGE as the source of truth for layout and structure.
Use the OCR text to confirm values.

RULES:

1. Item names are words/phrases.
1. Quantities are small integers (1-10).
1. Unit prices are the price for one item.
1. Total price = quantity x unit_price.
1. If qty > 1, repeat the item that many times as separate entries each with unit_price and total_price = unit_price (not the full total).
1. Extract service charge percentage if mentioned.
1. Extract VAT/tax percentage if mentioned.
1. Extract tips if mentioned.
1. subtotal = sum of all (unit_price x quantity).
1. total = final amount paid.

OCR TEXT:
${ocrText}

Return ONLY valid JSON, no markdown, no explanation:
{
“items”: [
{“name”: “Item Name”, “quantity”: 1, “unit_price”: 0.000, “total_price”: 0.000}
],
“subtotal”: 0.000,
“service_pct”: 0.0,
“service_amount”: 0.000,
“vat_pct”: 0.0,
“vat_amount”: 0.000,
“tips”: 0.000,
“total”: 0.000,
“currency”: “USD”
}`;

```
const geminiPayload = {
  contents: [
    {
      parts: [
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: imageBase64,
          },
        },
        {
          text: prompt,
        },
      ],
    },
  ],
  generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 2048,
  },
};

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiPayload),
  }
);

if (!geminiRes.ok) {
  const errText = await geminiRes.text();
  return res.status(502).json({ error: "Gemini API error", details: errText });
}

const geminiData = await geminiRes.json();
const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
const cleaned = rawText.replace(/```json|```/g, "").trim();

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  return res.status(422).json({ error: "Failed to parse Gemini response", raw: cleaned });
}

return res.status(200).json(parsed);
```

} catch (error) {
return res.status(500).json({ error: error.message });
}
}
