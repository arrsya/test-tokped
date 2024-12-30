const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

// Utility untuk menambahkan delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// User-Agent List untuk menghindari blokir
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
];

// Fungsi untuk scraping detail produk Tokopedia
async function scrapeProductDetail(productUrl) {
  try {
    console.log(`Starting scraping for: ${productUrl}`);
    
    // Randomize User-Agent
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Fetch HTML dari URL
    const response = await axios.get(productUrl, {
      headers: { "User-Agent": randomUserAgent },
      timeout: 10000,
    });

    console.log("HTML fetched successfully!");
    const $ = cheerio.load(response.data);

    // Scrape Title
    const productTitle = $('h1[data-testid="lblPDPDetailProductName"]').text().trim();
    console.log("Product Title:", productTitle);

    // Scrape Price
    const productPrice = $('div[data-testid="lblPDPDetailProductPrice"]').text().trim();
    console.log("Product Price:", productPrice);

    // Scrape Images
    const productImages = $('[data-testid="PDPImageThumbnail"] img')
      .map((_, el) => $(el).attr("src"))
      .get()
      .filter(Boolean);
    console.log("Product Images:", productImages);

    // Scrape Description
    const productDescription = $('div[data-testid="lblPDPDescriptionProduk"]').text().trim();
    console.log("Product Description:", productDescription);

    return {
      productTitle,
      productPrice,
      productImages,
      productDescription,
    };
  } catch (error) {
    console.error("Error during scraping:", error.message);
    throw new Error("Failed to scrape product details. Please check the URL or try again later.");
  }
}

// Endpoint untuk scraping
app.get("/api/tokopedia-product", async (req, res) => {
  const productUrl = req.query.url;

  if (!productUrl) {
    return res.status(400).json({ error: "Missing product URL in query parameters" });
  }

  try {
    const productDetails = await scrapeProductDetail(productUrl);
    res.json(productDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
