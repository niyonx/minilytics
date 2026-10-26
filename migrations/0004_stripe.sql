-- Signing secret of the site's Stripe webhook endpoint (POST /api/webhooks/stripe/:siteId).
ALTER TABLE sites ADD COLUMN stripe_webhook_secret TEXT;
