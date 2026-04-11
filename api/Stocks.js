// api/stocks.js
const axios = require('axios');

export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;
    
    // 1. Define the "Big List" of symbols you want to track
    // We use suffixes: .CA (Egypt), .SR (Saudi), .AD (Abu Dhabi), .DFM (Dubai)
    const symbols = [
        // Arab Countries (Top Picks)
        "JUFO.CA", "TMGH.CA", "SWDY.CA", // Egypt
        "2222.SR", "1120.SR", "7010.SR", // Saudi (Aramco, Al Rajhi, STC)
        "FAB.AD", "ETISALAT.AD",         // Abu Dhabi
        "EMAAR.DFM",                     // Dubai
        
        // US & Europe
        "AAPL", "MSFT", "GOOGL", "TSLA", "NVDA", // US
        "ASML.AS", "MC.PA", "SAP.DE"             // Europe (Netherlands, France, Germany)
    ];

    const symbolsString = symbols.join(",");
    const url = `https://api.twelvedata.com/price?symbol=${symbolsString}&apikey=${apiKey}`;

    try {
        // 2. Get Prices from Twelve Data
        const response = await axios.get(url);
        const prices = response.data;

        // 3. Get USD/EGP Exchange Rate (to meet your 'USD only' requirement)
        const rateResponse = await axios.get(`https://api.twelvedata.com/exchange_rate?symbol=USD/EGP&apikey=${apiKey}`);
        const egpRate = rateResponse.data.rate;

        // 4. Format the final JSON for your iOS App
        const formattedData = Object.keys(prices).map(symbol => {
            let rawPrice = parseFloat(prices[symbol].price);
            let currency = symbol.endsWith(".CA") || symbol.endsWith(".SR") ? "Local" : "USD";
            
            // Logic: Convert Egyptian stocks to USD automatically
            let priceInUSD = symbol.endsWith(".CA") ? (rawPrice / egpRate) : rawPrice;

            return {
                ticker: symbol,
                price_usd: priceInUSD.toFixed(2),
                original_price: rawPrice.toFixed(2),
                is_arab_market: symbol.includes(".") && !symbol.endsWith(".AS") && !symbol.endsWith(".PA")
            };
        });

        res.status(200).json({
            last_updated: new Date().toISOString(),
            usd_egp_rate: egpRate,
            stocks: formattedData
        });

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch stock data" });
    }
}
