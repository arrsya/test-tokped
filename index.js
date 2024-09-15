const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const compression = require('compression');

const app = express();
app.use(compression());

// Implement caching
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const retryRequest = async (url, retries = 2, delayMs = 500) => {
  if (!url) throw new Error('Invalid URL: URL is undefined');
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'},
        timeout: 5000 // 5 second timeout
      });
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

async function scrapeProductDetail(productUrl) {
  const $ = cheerio.load((await retryRequest(productUrl)).data);
  
  const productImages = $('[data-testid="PDPImageThumbnail"] img')
    .map((_, el) => {
      const src = $(el).attr('src');
      return src && !src.includes('svg') ? src.replace('100-square', '500-square') : null;
    })
    .get()
    .filter(Boolean);

  const mainImage = $('[data-testid="PDPMainImage"]').attr('src');
  if (mainImage && !productImages.includes(mainImage)) productImages.unshift(mainImage);

  return {
    productTitle: $('h1[data-testid="lblPDPDetailProductName"]').text().trim(),
    productPrice: $('div[data-testid="lblPDPDetailProductPrice"]').text().trim(),
    productImages,
    productDescription: $('div[data-testid="lblPDPDescriptionProduk"]').text().trim(),
    sizeInfo: {
      count: $('[data-testid="pdpVariantTitle#0"]').text().trim().match(/(\d+)\s*size/i)?.[1] || "N/A",
      sizes: $('.css-hayuji [data-testid="btnVariantChipInactive"] button').map((_, el) => $(el).text().trim()).get()
    }
  };
}

async function scrapeTokopediaShop(shopUrl) {
  const $ = cheerio.load((await retryRequest(shopUrl)).data);
  const results = [];

  $('.css-54k5sq').slice(0, 5).each((_, element) => {
    const $el = $(element);
    results.push({
      productTitle: $el.find('[data-testid="linkProductName"]').text().trim(),
      productPrice: $el.find('[data-testid="linkProductPrice"]').text().trim(),
      productImage: $el.find('[data-testid="imgProduct"]').attr('src'),
      productLink: $el.find('a').attr('href'),
      productStatus: $el.find('.css-1bqlscy').text().trim(),
      productRating: $el.find('.prd_rating-average-text').text().trim(),
      productSold: $el.find('.prd_label-integrity').text().trim(),
      productCampaign: $el.find('[aria-label="campaign"]').text().trim()
    });
  });

  const productDetails = await Promise.all(
    results.map(async product => {
      if (product.productLink) {
        try {
          const details = await scrapeProductDetail(product.productLink);
          return { ...product, ...details };
        } catch (error) {
          console.error(`Error fetching details for ${product.productLink}:`, error);
          return product;
        }
      }
      return product;
    })
  );

  return {
    shopName: $('[data-testid="shopNameHeader"]').text().trim(),
    shopLocation: $('[data-testid="shopLocationHeader"]').text().trim(),
    products: productDetails
  };
}

app.get('/api/tokopedia-shop', async (req, res) => {
  const shopUrl = req.query.url;
  if (!shopUrl) return res.status(400).json({ error: 'Shop URL is required' });

  const cachedData = cache.get(shopUrl);
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
    return res.json(cachedData.data);
  }

  try {
    const data = await scrapeTokopediaShop(shopUrl);
    cache.set(shopUrl, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while scraping the shop' });
  }
});

app.get('/api/tokopedia-product', async (req, res) => {
  const productUrl = req.query.url;
  if (!productUrl) return res.status(400).json({ error: 'Product URL is required' });

  const cachedData = cache.get(productUrl);
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
    return res.json(cachedData.data);
  }

  try {
    const data = await scrapeProductDetail(productUrl);
    cache.set(productUrl, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while scraping the product' });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: "Tokopedia Scraper API",
    author: "Fskhri",
    version: "1.0.0",
    endpoints: [
      {
        name: "Scrape Tokopedia Shop",
        method: "GET",
        path: "/api/tokopedia-shop",
        params: { url: "Shop URL (required)" },
        example: "/api/tokopedia-shop?url=https://www.tokopedia.com/officialjkt48/etalase/pre-order-jkt48-birthday-t-shirt"
      },
      {
        name: "Scrape Individual Product",
        method: "GET",
        path: "/api/tokopedia-product",
        params: { url: "Product URL (required)" },
        example: "/api/tokopedia-product?url=https://www.tokopedia.com/officialjkt48/pre-order-jkt48-birthday-t-shirt-azizi-asadel-2024"
      }
    ]
  });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3002;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}