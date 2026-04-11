export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  try {
    // ==============================
    // STOCK CONFIG
    // ==============================
    const STOCKS = [
      { symbol: "AAPL", country: "USA", currency: "USD" },
      { symbol: "MSFT", country: "USA", currency: "USD" },
      { symbol: "TSLA", country: "USA", currency: "USD" },
      { symbol: "7203.T", country: "Japan", currency: "JPY" },
      { symbol: "SAP.DE", country: "Germany", currency: "EUR" },
      { symbol: "2222.SR", country: "Saudi Arabia", currency: "SAR" },
      { symbol: "COMI.CA", country: "Egypt", currency: "EGP" }
    ];

    const symbols = STOCKS.map(s => s.symbol).join(",");

    // ==============================
    // FETCH STOCKS
    // ==============================
    let stocks = [];
    try {
      const stockRes = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`,
        {
          headers: { "User-Agent": "Mozilla/5.0" }
        }
      );
      const stockJson = await stockRes.json();

      const fxRes = await fetch(`https://api.exchangerate.host/latest?base=USD`);
      const fxJson = await fxRes.json();

      stocks = stockJson.quoteResponse.result.map((s) => {
        const meta = STOCKS.find(m => m.symbol === s.symbol);

        const usd = s.regularMarketPrice || 0;
        const rate = fxJson.rates[meta.currency] || 1;

        return {
          symbol: s.symbol,
          name: s.shortName,
          country: meta.country,
          currency: meta.currency,
          price_usd: usd,
          price_local: Number((usd * rate).toFixed(2))
        };
      });

    } catch (e) {
      console.error("STOCK ERROR:", e);
    }

    // ==============================
    // FETCH CRYPTO
    // ==============================
    let crypto = [];
    try {
      const cryptoRes = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=20`
      );
      const cryptoJson = await cryptoRes.json();

      crypto = cryptoJson.map(c => ({
        name: c.name,
        symbol: c.symbol.toUpperCase(),
        price_usd: c.current_price
      }));

    } catch (e) {
      console.error("CRYPTO ERROR:", e);
    }

    // ==============================
    // FETCH METALS
    // ==============================
    let metals = [];
    try {
      const metalsRes = await fetch(`https://api.metals.live/v1/spot`);
      const metalsJson = await metalsRes.json();

      metals = metalsJson.map(m => {
        const key = Object.keys(m)[0];
        return {
          name: key,
          price_usd: m[key]
        };
      });

    } catch (e) {
      console.error("METALS ERROR:", e);
    }

    // ==============================
    // FINAL RESPONSE
    // ==============================
    res.status(200).json({
      success: true,
      data: {
        stocks,
        crypto,
        metals
      },
      last_updated: new Date().toISOString()
    });

  } catch (err) {
    console.error("FATAL ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
