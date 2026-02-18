import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function (req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const userText = req.body.message || "اكلت ب ٢٠٠ جنيه و شريت قهوه ب ٣٠٠ و حولت من حساب cib لحساب hsbc ٢٠٠ جنيه";

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are a financial data extractor. Extract ALL transactions from the text.
          Format the output as a JSON ARRAY of objects.
          Each object must have: {"type": "expense|income|transfer", "amount": number, "currency": "EGP", "category": string, "item": string, "from": string|null, "to": string|null}.
          Return ONLY the JSON array.`
        },
        {
          role: "user",
          content: userText,
        },
      ],
      temperature: 0.1, // لضمان الدقة في الأرقام
      response_format: { type: "json_object" } // Groq يدعم إجبار الموديل على JSON
    });

    const result = completion.choices[0]?.message?.content;
    
    // إرسال النتيجة النهائية
    return res.status(200).json({
      success: true,
      data: JSON.parse(result)
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
