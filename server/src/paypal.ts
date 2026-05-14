/**
 * PayPal Subscriptions Client — Handles plan creation, subscription lifecycle,
 * and webhook verification for BiblioVault's subscription system.
 * 
 * Uses PayPal Subscriptions API v1 (not Checkout):
 *   - Auto-recurring monthly billing
 *   - 7-day free trial
 *   - Webhook notifications for renewals/cancellations
 */

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'live';

const PAYPAL_API = PAYPAL_MODE === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

console.log(`💳 PayPal: ${PAYPAL_MODE} mode (${PAYPAL_CLIENT_ID ? 'configured' : '⚠️ missing credentials'})`);

// ── Auth Token ──

let cachedToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${err}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.token;
}

// ── Product + Plan (one-time setup) ──

export async function ensureSubscriptionPlan(): Promise<string> {
  const token = await getAccessToken();

  const existingPlanId = process.env.PAYPAL_PLAN_ID;
  if (existingPlanId) {
    console.log(`💳 Using existing PayPal Plan: ${existingPlanId}`);
    return existingPlanId;
  }

  // 1. Create Product
  const productRes = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Lectura Arcana — Biblioteca Digital',
      description: 'Acceso completo a la biblioteca digital con AI, narración y chat inteligente.',
      type: 'SERVICE',
      category: 'BOOKS_PERIODICALS_AND_NEWSPAPERS',
    }),
  });

  if (!productRes.ok) {
    const err = await productRes.text();
    throw new Error(`Failed to create product: ${err}`);
  }
  const product = await productRes.json() as { id: string };
  console.log(`💳 Created PayPal Product: ${product.id}`);

  // 2. Create Plan with 7-day trial
  const planRes = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_id: product.id,
      name: 'Lectura Arcana Mensual',
      description: 'Acceso completo a BiblioVault AI — $12.99/mes con 7 días gratis',
      billing_cycles: [
        {
          frequency: { interval_unit: 'DAY', interval_count: 7 },
          tenure_type: 'TRIAL',
          sequence: 1,
          total_cycles: 1,
          pricing_scheme: {
            fixed_price: { value: '0', currency_code: 'USD' },
          },
        },
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 2,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: '12.99', currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    }),
  });

  if (!planRes.ok) {
    const err = await planRes.text();
    throw new Error(`Failed to create plan: ${err}`);
  }

  const plan = await planRes.json() as { id: string };
  console.log(`💳 Created PayPal Plan: ${plan.id}`);
  console.log(`⚠️ IMPORTANT: Add PAYPAL_PLAN_ID=${plan.id} to your .env and Render env vars`);

  return plan.id;
}

// ── Create Subscription ──

export async function createSubscription(
  planId: string,
  returnUrl: string,
  cancelUrl: string,
  userEmail: string,
): Promise<{ subscriptionId: string; approvalUrl: string }> {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: planId,
      subscriber: {
        email_address: userEmail,
      },
      application_context: {
        brand_name: 'Lectura Arcana',
        locale: 'es-MX',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create subscription: ${err}`);
  }

  const data = await res.json() as {
    id: string;
    links: Array<{ rel: string; href: string }>;
  };

  const approvalLink = data.links.find(l => l.rel === 'approve');
  if (!approvalLink) throw new Error('No approval URL in PayPal response');

  return {
    subscriptionId: data.id,
    approvalUrl: approvalLink.href,
  };
}

// ── Get Subscription Details ──

export async function getSubscriptionDetails(subscriptionId: string) {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok) return null;

  return await res.json() as {
    id: string;
    status: string;
    subscriber: { email_address: string; payer_id: string };
    billing_info: {
      next_billing_time?: string;
      last_payment?: { amount: { value: string } };
    };
    start_time: string;
  };
}

// ── Cancel Subscription ──

export async function cancelSubscription(subscriptionId: string, reason = 'User requested cancellation') {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  return res.ok || res.status === 204;
}

// ── Verify Webhook Signature ──

export async function verifyWebhook(
  headers: Record<string, string>,
  body: string,
  webhookId: string,
): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
    });

    if (!res.ok) return false;
    const data = await res.json() as { verification_status: string };
    return data.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

export { PAYPAL_CLIENT_ID, PAYPAL_API };
