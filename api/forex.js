let cachedData = null;
let lastFetchTime = null;

export default async function handler(req, res) {
  try {
    const ONE_HOUR = 60 * 60 * 1000;

    if (cachedData && lastFetchTime && (Date.now() - lastFetchTime < ONE_HOUR)) {
      return res.status(200).json({
        source: "cache",
        last_updated: new Date(lastFetchTime).toISOString(),
        data: cachedData
      });
    }

    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_API_KEY}/latest/USD`
    );

    const data = await response.json();

    if (data.result !== "success") {
      return res.status(500).json({ error: "Failed to fetch exchange rates" });
    }

    cachedData = data.conversion_rates;
    lastFetchTime = Date.now();

    return res.status(200).json({
      source: "api",
      last_updated: new Date(lastFetchTime).toISOString(),
      data: cachedData
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
