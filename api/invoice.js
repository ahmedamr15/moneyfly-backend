async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

    const prompt = "You are a receipt reconstruction engine.\n" +
      "You are given BOTH the receipt image AND raw OCR text.\n" +
      "Use the IMAGE as the source of truth for layout and structure.\n" +
      "Use the OCR text to confirm values.\n\n" +
      "RULES FOR ITEMS:\n" +
      "1. Item names are words/phrases.\n" +
      "2. Read the QTY column carefully from the image.\n" +
      "3. unit_price is always the price for ONE single item.\n" +
      "4. total_price = quantity x unit_price.\n" +
      "5. QUANTITY RULES:\n" +
      "   a) If qty is a whole number >= 1 (e.g. 1, 2, 3):\n" +
      "      - unit_price = total_price / quantity\n" +
      "      - Repeat the item exactly qty times in the items array\n" +
      "      - Each repeated entry has quantity=1 and unit_price=unit_price\n" +
      "      - Example: Burger qty=2 price=100 -> two entries {name:Burger,quantity:1,unit_price:50,total_price:50}\n" +
      "   b) If qty is less than 1 (e.g. 0.42 - sold by weight/kilo):\n" +
      "      - Keep as single entry, quantity=that decimal, is_by_weight=true\n" +
      "      - unit_price = price per kilo, total_price = qty x unit_price\n" +
      "6. Ignore sub-items with 0.00 amount (they are flavor variants, not separate items).\n\n" +
      "RULES FOR EXTRAS (very important):\n" +
      "7. Everything that is NOT a food/drink item is an EXTRA.\n" +
      "   This includes: service charge, GST, VAT, tax, tips, gratuity, round off, levy, surcharge, etc.\n" +
      "8. Collect ALL extras into a single array with their description and amount.\n" +
      "9. extras_total = sum of all extra amounts (round off can be negative).\n" +
      "10. subtotal = sum of all item total_prices (before any extras).\n" +
      "11. total = subtotal + extras_total (should match receipt final amount).\n\n" +
      "OCR TEXT:\n" + ocrText + "\n\n" +
      "Return ONLY valid JSON, no markdown, no explanation:\n" +
      "{\"items\":[{\"name\":\"\",\"quantity\":1,\"unit_price\":0.000,\"total_price\":0.000,\"is_by_weight\":false}]," +
      "\"extras\":[{\"description\":\"\",\"amount\":0.000}]," +
      "\"extras_total\":0.000," +
      "\"subtotal\":0.000," +
      "\"total\":0.000," +
      "\"currency\":\"USD\"}";

    const geminiPayload = {
      contents: [{
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    };

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: "Gemini API error", details: errText });
    }

    const geminiData = await geminiRes.json();
    const rawText = (geminiData &&
      geminiData.candidates &&
      geminiData.candidates[0] &&
      geminiData.candidates[0].content &&
      geminiData.candidates[0].content.parts &&
      geminiData.candidates[0].content.parts[0] &&
      geminiData.candidates[0].content.parts[0].text) || "";

    const cleaned = rawText.replace(/```json|```/g, "").trim();

    var parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(422).json({ error: "Failed to parse Gemini response", raw: cleaned });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
module.exports = handler;
