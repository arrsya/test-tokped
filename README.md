# JKT48 TOKOPEDIA SCRAPPER

## Overview
This is a simple API for scraping product and shop information from Tokopedia.

- **Author**: Fskhri
- **Version**: 1.0.0

## Endpoints

### 1. Scrape Tokopedia Shop

Retrieves information about a Tokopedia shop and its products.

- **Method**: GET
- **Path**: `/api/tokopedia-shop`
- **Parameters**:
  - `url`: Shop URL (required)
- **Example**:
  ```
  /api/tokopedia-shop?url=https://www.tokopedia.com/officialjkt48/etalase/pre-order-jkt48-birthday-t-shirt
  ```

### 2. Scrape Individual Product

Retrieves detailed information about a specific Tokopedia product.

- **Method**: GET
- **Path**: `/api/tokopedia-product`
- **Parameters**:
  - `url`: Product URL (required)
- **Example**:
  ```
  /api/tokopedia-product?url=https://www.tokopedia.com/officialjkt48/pre-order-jkt48-birthday-t-shirt-azizi-asadel-2024
  ```

## Usage

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the server: `node index.js`
4. The server will run at `http://localhost:3002`

## Note

This API is for educational purposes only. Make sure to comply with Tokopedia's terms of service and robots.txt when using this scraper.

## License

[MIT License](LICENSE)
