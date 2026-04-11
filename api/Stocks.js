export default async function handler(req, res) {
  try {
    // ===== A. STOCKS BY COUNTRY =====
    const stocks = [
      {
        country: "USA",
        currency: "USD",
        stocks: [
          { symbol: "AAPL", name: "Apple", price: 175.32 },
          { symbol: "MSFT", name: "Microsoft", price: 320.11 },
          { symbol: "TSLA", name: "Tesla", price: 210.45 }
        ]
      },
      {
        country: "Egypt",
        currency: "EGP",
        stocks: [
          { symbol: "COMI", name: "CIB", price: 72.5 },
          { symbol: "ETEL", name: "Telecom Egypt", price: 31.2 },
          { symbol: "HRHO", name: "EFG Holding", price: 18.9 }
        ]
      },
      {
        country: "Saudi Arabia",
        currency: "SAR",
        stocks: [
          { symbol: "2222", name: "Aramco", price: 32.1 },
          { symbol: "1120", name: "Al Rajhi Bank", price: 78.4 }
        ]
      }
    ];

    // ===== B. CRYPTO =====
    const crypto = [
      { name: "Bitcoin", symbol: "BTC", price_usd: 68000 },
      { name: "Ethereum", symbol: "ETH", price_usd: 3500 },
      { name: "Solana", symbol: "SOL", price_usd: 140 }
    ];

    // ===== C. METALS =====
    const metals = [
      { name: "Gold", symbol: "XAU", price_usd: 2350 },
      { name: "Silver", symbol: "XAG", price_usd: 28.5 },
      { name: "Platinum", symbol: "XPT", price_usd: 980 }
    ];

    // ===== FINAL RESPONSE =====
    const response = {
      success: true,
      data: {
        stocks_by_country: stocks,
        crypto: crypto,
        metals: metals
      },
      last_updated: new Date().toISOString()
    };

    res.status(200).json(response);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch investment data"
    });
  }
}
