/**
 * PayPal Subscriptions Module — Phase 14
 * Handles product creation, plan management, subscription lifecycle, and webhooks.
 */

import { getPgPool } from './pgDatabase.js';

// ── Config ──

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_PLAN_ID = process.env.PAYPAL_PLAN_ID || '';

const PLAN_PRICE = '12.99';
const PLAN_CURRENCY = 'USD';

// ── OAuth2 Access Token ──

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getPayPalAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal OAuth failed: ${err}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ── Create Subscription ──

export async function createSubscription(
  userId: string,
  returnUrl: string,
  cancelUrl: string,
  couponDiscount?: number,
): Promise<{ subscriptionId: string; approveUrl: string }> {
  const token = await getPayPalAccessToken();

  const body: any = {
    plan_id: PAYPAL_PLAN_ID,
    application_context: {
      brand_name: 'Lectura Arcana',
      locale: 'es-MX',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };

  // Apply coupon discount as plan override for first billing cycle
  if (couponDiscount && couponDiscount > 0 && couponDiscount <= 100) {
    const discountedPrice = (parseFloat(PLAN_PRICE) * (1 - couponDiscount / 100)).toFixed(2);
    body.plan = {
      billing_cycles: [
        {
          sequence: 1,
          total_cycles: 1,
          pricing_scheme: {
            fixed_price: { value: discountedPrice, currency_code: PLAN_CURRENCY },
          },
        },
        {
          sequence: 2,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: PLAN_PRICE, currency_code: PLAN_CURRENCY },
          },
        },
      ],
    };
  }

  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('PayPal create subscription error:', err);
    throw new Error('Error al crear suscripción en PayPal');
  }

  const data = await res.json();
  const approveLink = data.links?.find((l: any) => l.rel === 'approve');

  if (!approveLink) {
    throw new Error('No se encontró URL de aprobación de PayPal');
  }

  // Save subscription ID to user (pending state)
  const pool = getPgPool();
  await pool.query(`
    UPDATE users SET paypal_subscription_id = $1, subscription_status = 'pending'
    WHERE id = $2
  `, [data.id, userId]);

  return { subscriptionId: data.id, approveUrl: approveLink.href };
}

// ── Cancel Subscription ──

export async function cancelSubscription(subscriptionId: string, reason = 'Cancelado por el usuario'): Promise<void> {
  const token = await getPayPalAccessToken();

  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    console.error('PayPal cancel error:', err);
    throw new Error('Error al cancelar suscripción');
  }
}

// ── Get Subscription Details ──

export async function getSubscriptionDetails(subscriptionId: string): Promise<any> {
  const token = await getPayPalAccessToken();

  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok) return null;
  return res.json();
}

// ── Webhook Handler ──

export async function handlePayPalWebhook(event: any): Promise<void> {
  const pool = getPgPool();
  const eventType = event.event_type;
  const resource = event.resource;

  console.log(`PayPal webhook: ${eventType}`, resource?.id);

  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const subId = resource.id;
      const result = await pool.query(
        'SELECT id FROM users WHERE paypal_subscription_id = $1',
        [subId],
      );
      if (result.rows[0]) {
        await pool.query(`
          UPDATE users SET
            plan = 'premium',
            subscription_status = 'active',
            subscription_start = NOW()
          WHERE id = $1
        `, [result.rows[0].id]);
        console.log(`✅ User ${result.rows[0].id} activated premium`);
      }
      break;
    }

    case 'PAYMENT.SALE.COMPLETED': {
      const subId = resource.billing_agreement_id;
      const amount = resource.amount?.total || '12.99';
      const currency = resource.amount?.currency || 'USD';
      const paymentId = resource.id;

      const result = await pool.query(
        'SELECT id FROM users WHERE paypal_subscription_id = $1',
        [subId],
      );
      if (result.rows[0]) {
        await pool.query(`
          INSERT INTO payment_history (user_id, paypal_payment_id, amount, currency, status)
          VALUES ($1, $2, $3, $4, 'completed')
        `, [result.rows[0].id, paymentId, amount, currency]);

        // Ensure plan is premium
        await pool.query(`
          UPDATE users SET plan = 'premium', subscription_status = 'active'
          WHERE id = $1
        `, [result.rows[0].id]);
      }
      break;
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      const subId = resource.id;
      await pool.query(`
        UPDATE users SET
          plan = 'free',
          subscription_status = 'cancelled',
          subscription_end = NOW()
        WHERE paypal_subscription_id = $1
      `, [subId]);
      break;
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      const subId = resource.id;
      await pool.query(`
        UPDATE users SET
          plan = 'free',
          subscription_status = 'expired',
          subscription_end = NOW()
        WHERE paypal_subscription_id = $1
      `, [subId]);
      break;
    }

    default:
      console.log(`Unhandled PayPal event: ${eventType}`);
  }
}

// ── User Subscription Status ──

export async function getUserSubscription(userId: string) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT plan, paypal_subscription_id, subscription_status,
           subscription_start, subscription_end
    FROM users WHERE id = $1
  `, [userId]);

  const user = res.rows[0];
  if (!user) return null;

  let nextBilling: string | null = null;

  // If active, fetch next billing from PayPal
  if (user.subscription_status === 'active' && user.paypal_subscription_id) {
    try {
      const details = await getSubscriptionDetails(user.paypal_subscription_id);
      nextBilling = details?.billing_info?.next_billing_time || null;
    } catch {}
  }

  return {
    plan: user.plan,
    subscriptionId: user.paypal_subscription_id,
    status: user.subscription_status,
    startDate: user.subscription_start,
    endDate: user.subscription_end,
    nextBilling,
    price: PLAN_PRICE,
    currency: PLAN_CURRENCY,
  };
}

// ── Payment History ──

export async function getPaymentHistory(userId: string) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT * FROM payment_history
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `, [userId]);
  return res.rows;
}
