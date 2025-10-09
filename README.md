# Athletiq Shopify Webhooks (Vercel Edge)

Receives Shopify webhooks on a non-Shopify host per Shopify restrictions. Use this URL in Shopify Admin instead of your Oxygen/storefront domain.

## Endpoint

- POST /api/shopify/webhooks/orders/created

## Environment Variables (set in Vercel)

- SHOPIFY_WEBHOOK_SECRET
- PRIVATE_ADMIN_GRAPHQL_API_ENDPOINT (e.g. https://<shop>.myshopify.com/admin/api/2025-07/graphql.json)
- PRIVATE_ADMIN_GRAPHQL_API_TOKEN

## Deploy

- npm i -g vercel (or use Vercel dashboard)
- vercel to deploy and obtain the public URL
- Configure the Shopify webhook to the new URL
