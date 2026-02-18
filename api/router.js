module.exports = async function (req, res) {
  // التأكد من أن الطلب POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // مفتاح OpenRouter من إعدادات Vercel
  const API_KEY = process.env.OPENROUTER_API_KEY;
  const URL = "https://openrouter.ai/api/v1/chat/completions";

  try {
    // المحادثة الأولى: طلب الإجابة مع تفعيل الـ Reasoning
    const response1 = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "google/gemini-2.0-flash-thinking-exp:free", // موديل يدعم التفكير
        "messages": [
          {
            "role": "user",
            "content": "How many r's are in the word 'strawberry'?"
          }
        ],
        "include_reasoning": true // تفعيل خاصية التفكير في OpenRouter
      })
    });

    const result1 = await response1.json();
    const assistantMessage = result1.choices[0].message;

    // المحادثة الثانية: إرسال الرد السابق مع الـ Reasoning الخاص به للمتابعة
    const messages = [
      {
        role: 'user',
        content: "How many r's are in the word 'strawberry'?",
      },
      {
        role: 'assistant',
        content: assistantMessage.content,
        reasoning: assistantMessage.reasoning || null, // تمرير التفكير السابق
      },
      {
        role: 'user',
        content: "Are you sure? Think carefully.",
      },
    ];

    const response2 = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "model": "google/gemini-2.0-flash-thinking-exp:free",
        "messages": messages
      })
    });

    const result2 = await response2.json();
    
    // إرجاع النتيجة النهائية
    return res.status(200).json(result2.choices[0].message);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
