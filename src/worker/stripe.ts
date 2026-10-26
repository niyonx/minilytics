import type { Context } from 'hono';
import { getSite, type AppEnv } from './env';
import { verifyStripeWebhook } from './lib/crypto';
import { pickMeta, recordPayment, relinkPayments, str } from './payments';

const VISITOR_KEYS = ['ml_visitor_id', 'visitor_id', 'minilytics_visitor_id'];
const SESSION_KEYS = ['ml_session_id', 'session_id', 'minilytics_session_id'];

const id = (v: unknown) => (typeof v === 'string' ? v : str((v as { id?: unknown } | null)?.id));

/**
 * Stripe webhook: POST /api/webhooks/stripe/:siteId
 * Create the endpoint with API version 2024-06-20 and the events checkout.session.completed, invoice.paid and
 * charge.refunded, then store its signing secret in sites.stripe_webhook_secret.
 *  - invoice.paid records every subscription payment (first and renewals). The visitor comes from the
 *    subscription's metadata, or from the checkout session that started it (claimed below), or the usual fallbacks.
 *  - checkout.session.completed records one-time payments, and for subscriptions links the visitor in the
 *    session's metadata to the subscription, whichever of the two events arrives first.
 *  - charge.refunded subtracts the newly refunded amount.
 */
export async function handleStripeWebhook(c: Context<AppEnv>) {
  const site = await getSite(c.env.DB, c.req.param('siteId')!);
  if (!site) return c.json({ error: 'unknown site' }, 404);
  if (!site.stripe_webhook_secret) return c.json({ error: 'webhook secret not configured for this site' }, 400);

  const body = await c.req.text();
  if (!(await verifyStripeWebhook(site.stripe_webhook_secret, c.req.header('stripe-signature') ?? null, body))) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const event = JSON.parse(body) as { type: string; created: number; data: { object: Record<string, any>; previous_attributes?: Record<string, any> } };
  const o = event.data?.object ?? {};
  const ts = (Number(o.created) || event.created) * 1000 || Date.now();
  const db = c.env.DB;

  if (event.type === 'invoice.paid' && Number(o.amount_paid) > 0) {
    const meta = { ...o.subscription_details?.metadata, ...o.metadata } as Record<string, unknown>;
    await recordPayment(db, site, {
      id: String(o.id),
      provider: 'stripe',
      ts,
      amount: Number(o.amount_paid),
      kind: 'payment',
      currency: String(o.currency ?? site.currency),
      visitorId: pickMeta(meta, VISITOR_KEYS),
      sessionId: pickMeta(meta, SESSION_KEYS),
      customerId: id(o.customer),
      email: str(o.customer_email)?.toLowerCase() ?? null,
      name: str(o.customer_name),
      subscriptionId: id(o.subscription),
      renewal: o.billing_reason === 'subscription_cycle',
    });
  } else if (event.type === 'checkout.session.completed') {
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    const visitorId = pickMeta(meta, VISITOR_KEYS);
    const email = str(o.customer_details?.email)?.toLowerCase() ?? null;
    if (o.mode === 'payment' && o.payment_status === 'paid' && Number(o.amount_total) > 0) {
      await recordPayment(db, site, {
        id: id(o.payment_intent) ?? String(o.id),
        provider: 'stripe',
        ts,
        amount: Number(o.amount_total),
        kind: 'payment',
        currency: String(o.currency ?? site.currency),
        visitorId,
        sessionId: pickMeta(meta, SESSION_KEYS),
        customerId: id(o.customer),
        email,
        name: str(o.customer_details?.name),
      });
    } else if (o.mode === 'subscription' && visitorId) {
      const keys = [id(o.subscription), id(o.invoice)].filter((k): k is string => !!k);
      if (keys.length) {
        await db.batch(
          keys.map((k) =>
            db.prepare('INSERT OR IGNORE INTO payment_claims (site_id, payment_id, visitor_id, ts) VALUES (?, ?, ?, ?)').bind(site.id, k, visitorId, ts),
          ),
        );
        // invoice.paid may have arrived first and been recorded without a visitor.
        const rows = await db
          .prepare(
            `SELECT * FROM payments WHERE site_id = ? AND kind = 'payment' AND visitor_id IS NULL
             AND (id IN (${keys.map(() => '?').join(',')}) OR subscription_id IN (${keys.map(() => '?').join(',')}))`,
          )
          .bind(site.id, ...keys, ...keys)
          .all<any>();
        if (rows.results.length) await relinkPayments(db, site, rows.results);
      }
    }
  } else if (event.type === 'charge.refunded') {
    const refunded = Number(o.amount_refunded) - (Number(event.data.previous_attributes?.amount_refunded) || 0);
    if (refunded > 0) {
      const customerId = id(o.customer);
      const original = customerId
        ? await db
            .prepare("SELECT visitor_id, session_id FROM payments WHERE site_id = ? AND customer_id = ? AND kind = 'payment' ORDER BY ts DESC LIMIT 1")
            .bind(site.id, customerId)
            .first<{ visitor_id: string | null; session_id: string | null }>()
        : null;
      await db
        .prepare(
          `INSERT OR IGNORE INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name)
           VALUES (?, ?, 'stripe', ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `${o.id}:refund:${o.amount_refunded}`,
          site.id,
          event.created * 1000 || Date.now(),
          -refunded,
          String(o.currency ?? site.currency).toUpperCase(),
          original?.visitor_id ?? null,
          original?.session_id ?? null,
          customerId,
          str(o.billing_details?.email)?.toLowerCase() ?? null,
          str(o.billing_details?.name),
        )
        .run();
    }
  }
  // Every other event type is acknowledged so Stripe doesn't retry it.
  return c.json({ ok: true });
}
