const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = process.env.PORT || 3002;

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry logic
const retryRequest = async (url, retries = 3, delayMs = 1000) => {
  if (!url) {
    throw new Error('Invalid URL: URL is undefined');
  }
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Attempt ${i + 1} failed. Retrying in ${delayMs}ms...`);
      await delay(delayMs);
    }
  }
};

// Add this helper function at the top of the file
const logExecutionTime = (start, operation) => {
  const end = process.hrtime.bigint();
  const executionTime = Number(end - start) / 1e6; // Convert nanoseconds to milliseconds
  console.log(`${operation} completed in ${executionTime.toFixed(2)} ms (${(executionTime / 1000).toFixed(2)} seconds)`);
};

async function scrapeProductDetail(productUrl) {
  const response = await retryRequest(productUrl);
  const html = response.data;
  const $ = cheerio.load(html);
  
  const productImages = [];
  $('[data-testid="PDPImageThumbnail"] img').each((i, element) => {
    const imgSrc = $(element).attr('src');
    if (imgSrc && !imgSrc.includes('svg')) {
      // Replace thumbnail size with larger size
      const largeImgSrc = imgSrc.replace('100-square', '500-square');
      productImages.push(largeImgSrc);
    }
  });

  // Add main product image if not already included
  const mainImage = $('[data-testid="PDPMainImage"]').attr('src');
  if (mainImage && !productImages.includes(mainImage)) {
    productImages.unshift(mainImage);
  }

  const productTitle = $('h1[data-testid="lblPDPDetailProductName"]').text().trim();
  const productPrice = $('div[data-testid="lblPDPDetailProductPrice"]').text().trim();
  const productDescription = $('div[data-testid="lblPDPDescriptionProduk"]').text().trim();

  // Get product sizes
  const sizeInfo = $('[data-testid="pdpVariantTitle#0"]').text().trim();
  const sizeCount = sizeInfo.match(/(\d+)\s*size/i)?.[1] || "N/A";
  
  const productSizes = [];
  $('.css-hayuji [data-testid="btnVariantChipInactive"] button').each((i, element) => {
    productSizes.push($(element).text().trim());
  });

  return {
    productTitle,
    productPrice,
    productImages,
    productDescription,
    sizeInfo: {
      count: sizeCount,
      sizes: productSizes
    }
  };
}

async function scrapeTokopediaShop(shopUrl) {
  const response = await retryRequest(shopUrl);
  const html = response.data;
  const $ = cheerio.load(html);
  const results = [];

  // Get shop information
  const shopName = $('[data-testid="shopNameHeader"]').text().trim();
  const shopLocation = $('[data-testid="shopLocationHeader"]').text().trim();

  // Get product data from shop's etalase
  $('.css-54k5sq').slice(0, 10).each((i, element) => {
    const productTitle = $(element).find('[data-testid="linkProductName"]').text().trim();
    const productPrice = $(element).find('[data-testid="linkProductPrice"]').text().trim();
    const productImage = $(element).find('[data-testid="imgProduct"]').attr('src');
    const productLink = $(element).find('a').attr('href');
    const productStatus = $(element).find('.css-1bqlscy').text().trim();
    const productRating = $(element).find('.prd_rating-average-text').text().trim();
    const productSold = $(element).find('.prd_label-integrity').text().trim();
    const productCampaign = $(element).find('[aria-label="campaign"]').text().trim();

    results.push({
      productTitle,
      productPrice,
      productImage,
      productLink,
      productStatus,
      productRating,
      productSold,
      productCampaign
    });
  });

  // Use Promise.all with a timeout
  const timeout = ms => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
  const productPromises = results.map(product => {
    if (product.productLink) {
      return Promise.race([
        scrapeProductDetail(product.productLink)
          .then(detailData => Object.assign(product, detailData))
          .catch(error => {
            console.error(`Error fetching details for ${product.productLink}:`, error);
            return product;
          }),
        timeout(4000) // 4 second timeout for each product
      ]);
    }
    return Promise.resolve(product);
  });

  const completedProducts = await Promise.allSettled(productPromises);
  results.length = 0;
  completedProducts.forEach(result => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    }
  });

  return {
    shopName,
    shopLocation,
    products: results
  };
}

// Implement caching with a shorter duration
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// API endpoint
app.get('/api/tokopedia-shop', async (req, res) => {
  const shopUrl = req.query.url;
  if (!shopUrl) {
    return res.status(400).json({ error: 'Shop URL is required' });
  }

  const start = process.hrtime.bigint();

  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), 4900)
    );
    const dataPromise = scrapeTokopediaShop(shopUrl);
    
    const data = await Promise.race([dataPromise, timeoutPromise]);
    cache.set(shopUrl, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while scraping the shop' });
  } finally {
    logExecutionTime(start, 'Shop scraping');
  }
});

// New endpoint for individual product details
app.get('/api/tokopedia-product', async (req, res) => {
  const productUrl = req.query.url;
  if (!productUrl) {
    return res.status(400).json({ error: 'Product URL is required' });
  }

  const start = process.hrtime.bigint();

  try {
    const data = await scrapeProductDetail(productUrl);
    cache.set(productUrl, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while scraping the product' });
  } finally {
    logExecutionTime(start, 'Product scraping');
  }
});

// Root route to display usage information
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
        params: {
          url: "Shop URL (required)"
        },
        example: "/api/tokopedia-shop?url=https://www.tokopedia.com/officialjkt48/etalase/pre-order-jkt48-birthday-t-shirt"
      },
      {
        name: "Scrape Individual Product",
        method: "GET",
        path: "/api/tokopedia-product",
        params: {
          url: "Product URL (required)"
        },
        example: "/api/tokopedia-product?url=https://www.tokopedia.com/officialjkt48/pre-order-jkt48-birthday-t-shirt-azizi-asadel-2024"
      }
    ]
  });
});

// Ubah bagian akhir file
// Hapus app.listen() dan ganti dengan module.exports
module.exports = app;

// Tambahkan kondisi untuk menjalankan server saat di-develop secara lokal
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3002;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}