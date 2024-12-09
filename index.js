const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const compression = require('compression');

const app = express();
app.use(compression());

// Implement caching
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Simple concurrency control
class ConcurrencyLimit {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const limit = new ConcurrencyLimit(5);

// Adjust the retry settings and add proxy support
const retryRequest = async (url, retries = 2, delayMs = 1000) => {
  if (!url) throw new Error('Invalid URL: URL is undefined');
  
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    timeout: 10000, // Increase timeout to 10 seconds
    maxRedirects: 5,
    validateStatus: function (status) {
      return status >= 200 && status < 303; // Accept redirects
    }
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, options);
      if (response.status === 200) {
        return response;
      }
      throw new Error(`Invalid status code: ${response.status}`);
    } catch (error) {
      console.error(`Attempt ${i + 1}/${retries} failed for ${url}:`, error.message);
      
      if (i === retries - 1) {
        throw error;
      }
      
      // Exponential backoff
      const waitTime = delayMs * Math.pow(2, i);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

// Optimize scrapeProductDetail to only fetch necessary data
async function scrapeProductDetail(productUrl) {
  const $ = cheerio.load((await retryRequest(productUrl)).data);
  
  // Get only first 5 images
  const productImages = $('[data-testid="PDPImageThumbnail"] img')
    .slice(0, 5)
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
    productImages: productImages.slice(0, 5), // Limit to 5 images
    productDescription: $('div[data-testid="lblPDPDescriptionProduk"]').text().trim(),
    sizeInfo: {
      count: $('.css-hayuji [data-testid^="btnVariantChip"] button').length.toString(),
      sizes: $('.css-hayuji [data-testid^="btnVariantChip"] button')
        .map((_, el) => $(el).text().trim())
        .get()
    }
  };
}

async function scrapeTokopediaShop(shopUrl) {
  try {
    const response = await retryRequest(shopUrl);
    const $ = cheerio.load(response.data);
    const results = [];

    // Limit to first 10 products for faster response and reliability
    $('.css-54k5sq').slice(0, 10).each((_, element) => {
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

    // Process products in smaller batches
    const batchSize = 3;
    const productDetails = [];
    
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(product => {
          if (product.productLink) {
            return limit.run(async () => {
              try {
                const details = await scrapeProductDetail(product.productLink);
                return { ...product, ...details };
              } catch (error) {
                console.error(`Error fetching details for ${product.productLink}:`, error.message);
                return product;
              }
            });
          }
          return Promise.resolve(product);
        })
      );
      productDetails.push(...batchResults);
    }

    return {
      shopName: $('[data-testid="shopNameHeader"]').text().trim(),
      shopLocation: $('[data-testid="shopLocationHeader"]').text().trim(),
      products: productDetails
    };
  } catch (error) {
    console.error('Error in scrapeTokopediaShop:', error.message);
    throw new Error(`Failed to scrape shop: ${error.message}`);
  }
}

app.get('/api/tokopedia-shop', async (req, res) => {
  const shopUrl = req.query.url;
  if (!shopUrl) return res.status(400).json({ error: 'Shop URL is required' });

  try {
    const cachedData = cache.get(shopUrl);
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
      return res.json(cachedData.data);
    }

    const data = await scrapeTokopediaShop(shopUrl);
    cache.set(shopUrl, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Error in /api/tokopedia-shop:', error);
    res.status(error.response?.status || 500).json({ 
      error: 'An error occurred while scraping the shop',
      message: error.message
    });
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
