// api/gold.js

const GOLD_URLS = {
  "24": "https://ta3weem.com/ar/gold-prices/GOLD24K",
  "21": "https://ta3weem.com/ar/gold-prices/GOLD21K",
  "18": "https://ta3weem.com/ar/gold-prices/GOLD18K",
  "14": "https://ta3weem.com/ar/gold-prices/GOLD14K",
  pound: "https://ta3weem.com/ar/gold-prices/GOLDPOUND",
};

function cleanNumber(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, "");

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function extractPrice(text, arabicLabel) {
  const regex = new RegExp(`${arabicLabel}\\s*([\\d,]+(?:\\.\\d+)?)`);
  const match = text.match(regex);
  return cleanNumber(match?.[1]);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeOneGoldPrice(carat, url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MoneyFlyGoldBot/1.0; +https://moneyfly.app)",
      "Accept-Language": "ar,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${carat}. Status: ${response.status}`);
  }

  const html = await response.text();
  const text = htmlToText(html);

  return {
    buy: extractPrice(text, "أعلى سعر شراء"),
    sell: extractPrice(text, "أقل سعر بيع"),
    average: extractPrice(text, "متوسط السعر"),
  };
}

async function getAllGoldPrices() {
  const entries = Object.entries(GOLD_URLS);

  const results = await Promise.all(
    entries.map(async ([carat, url]) => {
      const prices = await scrapeOneGoldPrice(carat, url);

      return [
        carat,
        {
          unit: carat === "pound" ? "gold_pound" : "gram",
          ...prices,
        },
      ];
    })
  );

  return Object.fromEntries(results);
}

export default async function handler(req, res) {
  try {
    const prices = await getAllGoldPrices();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.status(200).json(prices);
  } catch (error) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.status(500).json({
      error: true,
      message: error.message,
    });
  }
}
