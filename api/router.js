module.exports = async function (req, res) {
  try {
    // 1. التأكد أن الطلب POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "الرجاء استخدام POST method" });
    }

    const API_KEY = process.env.OPENROUTER_API_KEY;
    const URL = "https://openrouter.ai/api/v1/chat/completions";

    // 2. التحقق من وجود المفتاح
    if (!API_KEY) {
      return res.status(500).json({ error: "مفتاح OPENROUTER_API_KEY غير موجود في إعدادات Vercel" });
    }

    // 3. إرسال الطلب لـ OpenRouter
    // استخدمنا موديل google/gemini-2.0-flash-thinking-exp:free لأنه مجاني ويدعم التفكير
    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", 
      },
      body: JSON.stringify({
        "model": "google/gemini-2.0-flash-thinking-exp:free",
        "messages": [
          {
            "role": "user",
            "content": req.body.message || "How many r's are in strawberry?"
          }
        ],
        "include_reasoning": true // لتفعيل التفكير (Reasoning)
      })
    });

    const data = await response.json();

    // 4. التحقق من الرد
    if (data && data.choices && data.choices.length > 0) {
      // إرجاع الإجابة مع الـ Reasoning إذا كان متاحاً
      return res.status(200).json({
        answer: data.choices[0].message.content,
        reasoning: data.choices[0].message.reasoning || "No reasoning details provided by this model"
      });
    } else {
      // في حال وجود خطأ في الكوتا أو الموديل من OpenRouter
      return res.status(200).json({
        error: "OpenRouter Error",
        details: data
      });
    }

  } catch (error) {
    return res.status(500).json({
      error: "حدث خطأ في السيرفر",
      message: error.message
    });
  }
};
