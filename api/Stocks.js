export default async function handler(req, res) {
  try {
    // ==============================
    // CACHE (1 hour)
    // ==============================
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

    // ==============================
    // STOCK LIST (you expand this)
    // ==============================
    const STOCKS = [
      { symbol: "AAPL", country: "USA", currency: "USD" },
      { symbol: "MSFT", country: "USA", currency: "USD" },
      { symbol: "TSLA", country: "USA", currency: "USD" },
      { symbol: "AMZN", country: "USA", currency: "USD" },

      { symbol: "7203.T", country: "Japan", currency: "JPY" },
      { symbol: "9984.T", country: "Japan", currency: "JPY" },

      { symbol: "SAP.DE", country: "Germany", currency: "EUR" },

      { symbol: "2222.SR", country: "Saudi Arabia", currency: "SAR" },

      { symbol: "COMI.CA", country: "Egypt", currency: "EGP" }
    ];

    // ==============================
    // FETCH STOCK PRICES
    // ==============================
    const symbols = STOCKS.map(s => s.symbol).join(",");

    const stockRes = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`
    );
    const stockJson = await stockRes.json();

    // ==============================
    // FETCH FX RATES
    // ==============================
    const fxRes = await fetch(
      `https://api.exchangerate.host/latest?base=USD`
    );
    const fxJson = await fxRes.json();

    // ==============================
    // FETCH CRYPTO (ALL TOP COINS)
    // ==============================
    const cryptoRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1`
    );
    const cryptoJson = await cryptoRes.json();

    // ==============================
    // FETCH METALS
    // ==============================
    const metalsRes = await fetch(`https://api.metals.live/v1/spot`);
    const metalsJson = await metalsRes.json();

    // ==============================
    // PROCESS STOCKS
    // ==============================
    const stocks = stockJson.quoteResponse.result.map((s) => {
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

    // ==============================
    // PROCESS CRYPTO
    // ==============================
    const crypto = cryptoJson.map(c => ({
      name: c.name,
      symbol: c.symbol.toUpperCase(),
      price_usd: c.current_price
    }));

    // ==============================
    // PROCESS METALS
    // ==============================
    const metals = metalsJson.map(m => {
      const key = Object.keys(m)[0];
      return {
        name: key,
        price_usd: m[key]
      };
    });

    // ==============================
    // RESPONSE
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
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Failed to fetch data"
    });
  }
}
