export default async function handler(req, res) {
  try {
    // نخلي Vercel يخزن الرد لمدة ساعة كاملة
    res.setHeader("Cache-Control", "s-maxage=3600");

    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_API_KEY}/latest/USD`
    );

    const data = await response.json();

    if (data.result !== "success") {
      return res.status(500).json({ error: data });
    }

    return res.status(200).json({
      last_updated: new Date().toISOString(),
      base: "USD",
      rates: data.conversion_rates
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
