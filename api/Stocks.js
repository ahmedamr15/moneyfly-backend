export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  try {
    // ==============================
    // STOCKS (Marketstack)
    // ==============================
    let stocks = [];
    try {
      const stockRes = await fetch(
        "http://api.marketstack.com/v1/eod/latest?access_key=c8ae8cd7f5d6a1e3756949da8496ab54&limit=50"
      );

      const stockJson = await stockRes.json();

      stocks = stockJson.data.map(s => ({
        symbol: s.symbol,
        name: s.exchange,
        country: s.exchange,
        currency: s.currency,
        price_usd: s.close, // not always USD
        price_local: s.close
      }));

    } catch (e) {
      console.error("STOCK ERROR:", e);
    }

    // ==============================
    // CRYPTO (CoinGecko)
    // ==============================
    let crypto = [];
    try {
      const cryptoRes = await fetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=20"
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
    // METALS (Simple fallback)
    // ==============================
    let metals = [
      { name: "Gold", price_usd: 2350 },
      { name: "Silver", price_usd: 28.5 },
      { name: "Platinum", price_usd: 980 }
    ];

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
    console.error("FATAL:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
