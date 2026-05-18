import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync, createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getPgPool, pgGetDashboardStats, pgGetAllUsersAdmin, pgGetPendingBooks, pgGetUserBooks, pgGetRecentUsers, pgGetRecentUploads, pgLogAdminAction, pgDeleteUser, pgAdminEditUser } from './pgDatabase.js';
import {
  initDatabase,
  isPostgres,
  getAllBooks,
  getBookById,
  updateBook,
  getCategories,
  getStats,
  getUnenrichedBooks,
  getBooksWithoutCovers,
  getUserById,
  updateUser,
  getCollections,
  createCollection,
  updateCollection as updateCollectionDb,
  deleteCollection as deleteCollectionDb,
  addBookToCollection,
  removeBookFromCollection,
  getBookCollections,
  getAffiliateLinks,
  upsertAffiliateLink,
  trackAffiliateClick,
  getUserUploads,
  countUserUploads,
  insertUserUpload,
  deleteUserUpload,
  insertUserBook,
  getUserReadingProgress,
  setUserReadingProgress,
  getUserFavorites,
  addUserFavorite,
  removeUserFavorite,
  isUserFavorite,
} from './db.js';
import { scanLibrary, type ScanProgress } from './scanner.js';
import { streamChat, checkHermesHealth, llmComplete, streamOrganizerChat } from './hermes.js';
import { extractPdfText, extractDocText, extractEpubText, extractBookExcerpt, isPdfTextBased } from './textExtractor.js';
import { generateCover, COVERS_DIR } from './coverGenerator.js';
import { enrichBook, runBatchEnrichment, getBatchState, cancelBatchEnrichment, resetBatchState } from './metadataEnricher.js';
import { extractPdfCover, extractEpubCover, extractImageCover, runBatchCoverExtraction, getCoverBatchState, cancelCoverBatchJob, resetCoverBatchState } from './pdfCoverExtractor.js';
import { identifyTitleFromPdf } from './aiTitleIdentifier.js';
import { searchWeb, formatSearchResults } from './webSearch.js';
import { getR2Stream, getR2Url, r2ObjectExists, isR2Configured } from './r2Storage.js';
import {
  initFtsSchema,
  searchFullText,
  searchInBook,
  runBatchIndexing,
  getIndexBatchState,
  cancelIndexBatch,
  resetIndexBatchState,
  getIndexStats,
  indexBookText,
} from './searchEngine.js';
import cookieParser from 'cookie-parser';
import {
  registerUser,
  loginUser,
  getAuthenticatedUser,
  COOKIE_NAME,
  getSessionCookieOptions,
} from './auth.js';
import {
  getCommunities, getCommunityBySlug, getCommunityById, getOrCreateBookCommunity,
  createCommunity, updateCommunity, joinCommunity, leaveCommunity,
  getCommunityMembers, isMember, getMemberRole, getUserCommunities,
  getThreads, getThread, createThread, updateThread, deleteThread,
  getReplies, createReply, deleteReply,
  vote, getUserVotes,
  seedOfficialForums,
  getBookCommunities, getOfficialCommunities, getRecentThreadsGlobal,
} from './community.js';
import { requireAuth, optionalAuth } from './middleware/requireAuth.js';
import {
  ensureSubscriptionPlan,
  createSubscription,
  getSubscriptionDetails,
  cancelSubscription,
  PAYPAL_CLIENT_ID,
} from './paypal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const LIBRARY_PATH = process.env.LIBRARY_PATH || 'C:\\Users\\Usuario\\OneDrive\\Documentos\\Lectura';

// Trust proxy for Render (HTTPS termination)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve static covers
app.use('/covers', express.static(COVERS_DIR));

// Initialize database on startup (async for PostgreSQL support)
await initDatabase();
await initFtsSchema();
await seedOfficialForums();
console.log('ðŸ“¦ Database initialized');

// Sync cover paths on startup â€” only for local SQLite mode
if (!isPostgres()) {
  const { getDb } = await import('./database.js');
  const db = getDb();
  const books = db.prepare('SELECT id, cover_path, cover_source FROM books').all() as Array<{
    id: number; cover_path: string; cover_source: string;
  }>;
  let updated = 0;
  for (const book of books) {
    // Check for API-downloaded covers
    const jpgPath = join(COVERS_DIR, `${book.id}.jpg`);
    const pngPath = join(COVERS_DIR, `${book.id}.png`);
    const pdfJpgPath = join(COVERS_DIR, `${book.id}_pdf.jpg`);

    if (existsSync(jpgPath) && book.cover_path !== jpgPath) {
      await updateBook(book.id, { cover_path: jpgPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pngPath) && book.cover_path !== pngPath) {
      await updateBook(book.id, { cover_path: pngPath, cover_source: 'api' } as any);
      updated++;
    } else if (existsSync(pdfJpgPath) && book.cover_path !== pdfJpgPath) {
      await updateBook(book.id, { cover_path: pdfJpgPath, cover_source: 'pdf' } as any);
      updated++;
    }
  }
  if (updated > 0) console.log(`ðŸ–¼ï¸  Cover sync: updated ${updated} book cover paths`);
}

// â”€â”€ Scan state â”€â”€
let currentScan: ScanProgress | null = null;
let scanRunning = false;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  API Routes
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Authentication â”€â”€


// -- Health Check --

const SERVER_START = Date.now();

app.get('/api/health', async (_req, res) => {
  const services: Record<string, string> = {};
  
  try {
    const s = await getStats();
    services.database = 'ok';
    services.books = String((s as any).total || 0);
  } catch {
    services.database = 'error';
  }

  const tunnelUrl = process.env.TUNNEL_URL;
  if (tunnelUrl) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(tunnelUrl + '/health', { signal: ctrl.signal }).catch(() => null);
      clearTimeout(t);
      services.tunnel = r?.ok ? 'ok' : 'unreachable';
    } catch { services.tunnel = 'unreachable'; }
  } else {
    services.tunnel = 'not_configured';
  }

  services.groq = process.env.GROQ_API_KEY ? 'ok' : 'no_key';

  res.json({
    status: services.database === 'ok' ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    services,
    version: '1.0.0',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const result = await registerUser(email, password, displayName || '');
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token!, getSessionCookieOptions());
    res.json({ user: result.user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error al registrar usuario.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token!, getSessionCookieOptions());
    res.json({ user: result.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error al iniciar sesiÃ³n.' });
  }
});

app.post('/api/auth/logout', async (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  
  const user = await getAuthenticatedUser(token);
  if (!user) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'SesiÃ³n invÃ¡lida.' });
  }

  const defaultAdmins = ['hbouche@hotmail.com'];
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const adminEmails = [...new Set([...defaultAdmins, ...envAdmins])];
  const isAdmin = adminEmails.includes((user as any).email?.toLowerCase());

  res.json({ user: { ...user, is_admin: isAdmin } });
});

app.put('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { displayName, avatar_url } = req.body;
    const updates: Record<string, string> = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    
    await updateUser(req.userId!, updates as any);
    const user = await getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Error al actualizar perfil.' });
  }
});

// ── Subscription System ──

// Initialize PayPal plan on startup
let paypalPlanId: string | null = null;
(async () => {
  try {
    if (PAYPAL_CLIENT_ID) {
      paypalPlanId = await ensureSubscriptionPlan();
    }
  } catch (err) {
    console.error('PayPal plan init error:', err);
  }
})();

// Helper: calculate subscription end date
function getSubscriptionEndDate(daysFromNow = 37): string {
  // 7 days trial + 30 days = 37 days for first subscription
  const end = new Date();
  end.setDate(end.getDate() + daysFromNow);
  return end.toISOString();
}

// Middleware: Check active subscription
async function requireSubscription(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }

  const user = await getUserById(req.userId) as any;
  if (!user) return res.status(401).json({ error: 'user_not_found' });

  // Admin always has access (configurable via env)
  const adminEmails = (process.env.ADMIN_EMAILS || 'admin@bibliovault.local').split(',').map(e => e.trim());
  if (adminEmails.includes(user.email)) return next();

  // Check subscription
  const status = user.subscription_status;
  const endDate = user.subscription_end ? new Date(user.subscription_end) : null;

  if (status === 'active' && endDate && endDate > new Date()) {
    return next(); // Active and not expired
  }

  if (status === 'cancelled' && endDate && endDate > new Date()) {
    return next(); // Cancelled but still within paid period
  }

  // Expired or no subscription — update status if needed
  if (status === 'active' && endDate && endDate <= new Date()) {
    await updateUser(user.id, { subscription_status: 'expired', plan: 'free' } as any);
  }

  return res.status(403).json({
    error: 'subscription_required',
    message: 'Tu suscripción ha expirado. Renueva para continuar.',
    subscription_status: status || 'none',
  });
}

// Middleware: Require admin role
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  const user = await getUserById(req.userId) as any;
  if (!user) return res.status(401).json({ error: 'user_not_found' });

  const defaultAdmins = ['hbouche@hotmail.com'];
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const adminEmails = [...new Set([...defaultAdmins, ...envAdmins])];
  if (!adminEmails.includes(user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'admin_only' });
  }
  next();
}

// Create subscription → redirect to PayPal
app.post('/api/subscription/create', requireAuth, async (req, res) => {
  try {
    if (!paypalPlanId) {
      return res.status(503).json({ error: 'PayPal no configurado' });
    }

    const user = await getUserById(req.userId!) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Already active?
    if (user.subscription_status === 'active' && user.subscription_end) {
      const end = new Date(user.subscription_end);
      if (end > new Date()) {
        return res.json({
          status: 'already_active',
          subscription_end: user.subscription_end,
        });
      }
    }

    // Determine return URLs
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'https://bibliovault.onrender.com';
    const returnUrl = `${origin}?subscription=success`;
    const cancelUrl = `${origin}?subscription=cancelled`;

    const result = await createSubscription(paypalPlanId, returnUrl, cancelUrl, user.email);

    // Store pending subscription ID
    await updateUser(user.id, {
      subscription_id: result.subscriptionId,
      subscription_status: 'pending',
    } as any);

    res.json({
      approvalUrl: result.approvalUrl,
      subscriptionId: result.subscriptionId,
    });
  } catch (err) {
    console.error('Subscription create error:', err);
    res.status(500).json({ error: 'Error al crear suscripción' });
  }
});

// Activate subscription (called after PayPal redirect)
app.post('/api/subscription/activate', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId!) as any;
    if (!user?.subscription_id) {
      return res.status(400).json({ error: 'No pending subscription' });
    }

    // Verify with PayPal
    const details = await getSubscriptionDetails(user.subscription_id);
    if (!details || (details.status !== 'ACTIVE' && details.status !== 'APPROVED')) {
      return res.status(400).json({
        error: 'Subscription not approved',
        paypal_status: details?.status,
      });
    }

    // Activate!
    const now = new Date();
    await updateUser(user.id, {
      plan: 'premium',
      subscription_status: 'active',
      subscription_start: now.toISOString(),
      subscription_end: getSubscriptionEndDate(37), // 7 trial + 30 days
      paypal_payer_id: details.subscriber?.payer_id || null,
    } as any);

    console.log(`💳 Subscription activated for ${user.email} (${user.subscription_id})`);

    res.json({
      status: 'active',
      plan: 'premium',
      subscription_end: getSubscriptionEndDate(37),
    });
  } catch (err) {
    console.error('Subscription activate error:', err);
    res.status(500).json({ error: 'Error al activar suscripción' });
  }
});

// Get subscription status
app.get('/api/subscription/status', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId!) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const isActive = user.subscription_status === 'active' || user.subscription_status === 'cancelled';
  const endDate = user.subscription_end ? new Date(user.subscription_end) : null;
  const hasAccess = isActive && endDate && endDate > new Date();

  res.json({
    plan: user.plan || 'free',
    subscription_status: user.subscription_status || 'none',
    subscription_id: user.subscription_id,
    subscription_start: user.subscription_start,
    subscription_end: user.subscription_end,
    has_access: !!hasAccess,
    days_remaining: hasAccess
      ? Math.ceil((endDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0,
  });
});

// Cancel subscription
app.post('/api/subscription/cancel', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId!) as any;
    if (!user?.subscription_id) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    // Cancel in PayPal (stops future billing)
    const cancelled = await cancelSubscription(user.subscription_id);
    if (!cancelled) {
      return res.status(500).json({ error: 'Failed to cancel in PayPal' });
    }

    // Mark as cancelled but keep access until subscription_end
    await updateUser(user.id, {
      subscription_status: 'cancelled',
      // plan stays 'premium' until subscription_end
    } as any);

    console.log(`💳 Subscription cancelled for ${user.email} — access until ${user.subscription_end}`);

    res.json({
      status: 'cancelled',
      access_until: user.subscription_end,
      message: `Tu acceso se mantiene hasta ${new Date(user.subscription_end).toLocaleDateString('es-MX')}`,
    });
  } catch (err) {
    console.error('Subscription cancel error:', err);
    res.status(500).json({ error: 'Error al cancelar suscripción' });
  }
});

// Activate subscription from inline PayPal JS SDK (no redirect)
app.post('/api/subscription/activate-inline', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId!) as any;
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Missing subscriptionId' });
    }

    // Verify with PayPal
    const details = await getSubscriptionDetails(subscriptionId);
    if (!details || (details.status !== 'ACTIVE' && details.status !== 'APPROVAL_PENDING')) {
      return res.status(400).json({ error: 'Suscripción no aprobada en PayPal' });
    }

    const now = new Date();
    await updateUser(user.id, {
      plan: 'premium',
      subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_start: now.toISOString(),
      subscription_end: getSubscriptionEndDate(37), // 7 trial + 30 days
    } as any);

    console.log(`💳 Inline subscription activated for ${user.email} (${subscriptionId})`);

    res.json({
      success: true,
      plan: 'premium',
      subscription_end: getSubscriptionEndDate(37),
    });
  } catch (err) {
    console.error('Inline subscription activate error:', err);
    res.status(500).json({ error: 'Error al activar suscripción' });
  }
});

// Redeem coupon code
app.post('/api/subscription/redeem-coupon', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId!) as any;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    // Configurable coupons via env var: CODE1:DAYS,CODE2:DAYS,...
    // Example: COUPON_CODES=BETA30:30,AMIGO7:7,PRUEBA14:14
    const couponConfig = process.env.COUPON_CODES || 'BETA30:30,PRUEBA7:7';
    const coupons = new Map<string, number>();
    couponConfig.split(',').forEach(c => {
      const [k, v] = c.split(':');
      if (k && v) coupons.set(k.trim().toUpperCase(), parseInt(v, 10));
    });

    const daysToGrant = coupons.get(code.toUpperCase());

    if (!daysToGrant) {
      return res.status(400).json({ error: 'Cupón inválido o expirado' });
    }

    const prefs = user.preferences ? (typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences) : {};
    const usedCoupons = prefs.usedCoupons || [];
    if (usedCoupons.includes(code.toUpperCase())) {
      return res.status(400).json({ error: 'Ya has utilizado este cupón.' });
    }
    
    usedCoupons.push(code.toUpperCase());

    // Grant access (extend from current if active, otherwise from now)
    const endDate = new Date();
    if (user.subscription_end && new Date(user.subscription_end) > endDate) {
      endDate.setTime(new Date(user.subscription_end).getTime());
    }
    endDate.setDate(endDate.getDate() + daysToGrant);

    await updateUser(user.id, {
      plan: 'premium',
      subscription_status: 'active',
      subscription_start: user.subscription_start || new Date().toISOString(),
      subscription_end: endDate.toISOString(),
      preferences: JSON.stringify({ ...prefs, usedCoupons })
    } as any);

    console.log(`🎟️ Coupon ${code} redeemed by ${user.email} — ${daysToGrant} days granted`);

    res.json({
      success: true,
      message: `¡Cupón activado! Tienes ${daysToGrant} días de acceso premium.`,
      days: daysToGrant,
      subscription_end: endDate.toISOString(),
    });
  } catch (err) {
    console.error('Coupon redeem error:', err);
    res.status(500).json({ error: 'Error al canjear cupón' });
  }
});

// PayPal Webhook (receives renewal, cancellation, failure notifications)
app.post('/api/webhooks/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString()) as {
      event_type: string;
      resource: { id: string; status: string };
    };

    console.log(`💳 PayPal Webhook: ${event.event_type}`);

    const subscriptionId = event.resource?.id;
    if (!subscriptionId) return res.sendStatus(200);

    // Find user by subscription_id
    const { getUserBySubscriptionId } = await import('./db.js');
    const user = await getUserBySubscriptionId(subscriptionId) as any;
    if (!user) {
      console.log(`💳 Webhook: No user found for subscription ${subscriptionId}`);
      return res.sendStatus(200);
    }

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RENEWED': {
        try {
          const { getSubscriptionDetails } = await import('./paypal.js');
          const details = await getSubscriptionDetails(subscriptionId);
          if (details?.billing_info?.next_billing_time) {
            const newEnd = new Date(details.billing_info.next_billing_time);
            await updateUser(user.id, {
              plan: 'premium',
              subscription_status: 'active',
              subscription_end: newEnd.toISOString(),
            } as any);
            console.log(`💳 Subscription renewed for ${user.email} → ${newEnd.toISOString()}`);
          }
        } catch (e) {
          console.error('Failed to sync paypal idempotency', e);
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        await updateUser(user.id, {
          subscription_status: 'cancelled',
          // Keep current subscription_end — user retains access until then
        } as any);
        console.log(`💳 Subscription cancelled/suspended for ${user.email}`);
        break;
      }
      case 'BILLING.SUBSCRIPTION.EXPIRED':
      case 'BILLING.SUBSCRIPTION.PAYMENT_FAILED': {
        // Check if already past end date
        const endDate = user.subscription_end ? new Date(user.subscription_end) : new Date();
        if (endDate <= new Date()) {
          await updateUser(user.id, {
            plan: 'free',
            subscription_status: 'expired',
          } as any);
          console.log(`💳 Subscription expired for ${user.email}`);
        }
        break;
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('PayPal webhook error:', err);
    res.sendStatus(200); // Always 200 to PayPal
  }
});

// Admin: Grant premium access to a user (for coupons, free passes)
app.post('/api/admin/grant-access', requireAuth, async (req, res) => {
  try {
    const admin = await getUserById(req.userId!) as any;
    const adminEmails = (process.env.ADMIN_EMAILS || 'admin@bibliovault.local').split(',').map((e: string) => e.trim());
    if (!admin || !adminEmails.includes(admin.email)) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { email, days } = req.body as { email: string; days?: number };
    if (!email) return res.status(400).json({ error: 'email required' });

    const accessDays = days || 30;
    const end = new Date();
    end.setDate(end.getDate() + accessDays);

    if (isPostgres()) {
      const pool = getPgPool();
      const { rowCount } = await pool.query(
        `UPDATE users SET plan = 'premium', subscription_status = 'active', 
         subscription_start = NOW(), subscription_end = $1
         WHERE email = $2`,
        [end.toISOString(), email]
      );
      if (!rowCount) return res.status(404).json({ error: 'User not found' });
    } else {
      const db = (await import('./database.js')).getDb();
      const result = db.prepare(
        `UPDATE users SET plan = 'premium', subscription_status = 'active',
         subscription_start = datetime('now'), subscription_end = ?
         WHERE email = ?`
      ).run(end.toISOString(), email);
      if (!result.changes) return res.status(404).json({ error: 'User not found' });
    }

    console.log(`💳 Admin granted ${accessDays} days premium to ${email}`);
    res.json({ success: true, email, access_until: end.toISOString(), days: accessDays });
  } catch (err) {
    console.error('Grant access error:', err);
    res.status(500).json({ error: 'Failed to grant access' });
  }
});

// ── Books ──
app.get('/api/books', optionalAuth, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 200;
  const offset = parseInt(req.query.offset as string) || 0;
  const format = req.query.format as string | undefined;
  const category_id = req.query.category_id ? parseInt(req.query.category_id as string) : undefined;
  const favorite = req.query.favorite === 'true' ? true : undefined;
  const search = req.query.search as string | undefined;
  const collection_id = req.query.collection_id ? parseInt(req.query.collection_id as string) : undefined;
  const language = req.query.language as string | undefined;
  const minPages = req.query.minPages ? parseInt(req.query.minPages as string) : undefined;
  const maxPages = req.query.maxPages ? parseInt(req.query.maxPages as string) : undefined;

  const result = await getAllBooks(limit, offset, { 
    format, category_id, favorite, search, collection_id, userId: req.userId || undefined,
    language, minPages, maxPages
  });
  res.json(result);
});

// User: Get my uploaded books (MUST be before /api/books/:id)
app.get('/api/books/my', requireAuth, async (req, res) => {
  try {
    const books = await pgGetUserBooks(req.userId!);
    res.json(books);
  } catch (err) {
    console.error('My books error:', err);
    res.status(500).json({ error: 'Error al obtener tus libros.' });
  }
});

// User: Get community books (MUST be before /api/books/:id)
app.get('/api/books/community', requireAuth, async (req, res) => {
  try {
    const p = getPgPool();
    const result = await p.query(`
      SELECT b.id, b.title, b.format, b.file_size, b.date_added,
             b.cover_path, b.category_id, c.name as category_name,
             u.display_name as uploader_name
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.visibility = 'public' AND b.uploaded_by IS NOT NULL AND b.uploaded_by != $1
      ORDER BY b.date_added DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Community books error:', err);
    res.status(500).json({ error: 'Error al obtener libros de comunidad.' });
  }
});

app.get('/api/books/:id', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id));
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});

app.patch('/api/books/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const allowed = [
    'category_id',
    'tags', 'subcategory', 'ai_summary', 'cover_path', 'cover_source',
    'title', 'author', 'description', 'isbn', 'pages',
    'enriched', 'original_title', 'enrichment_source',
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  await updateBook(id, updates);
  res.json({ ok: true });
});

// ── Per-User Reading Progress ──
app.get('/api/books/:id/progress', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.json({ progress: 0, current_page: 0 });
    const bookId = parseInt(req.params.id);
    const row = await getUserReadingProgress(user.id, bookId);
    res.json(row || { progress: 0, current_page: 0 });
  } catch {
    res.json({ progress: 0, current_page: 0 });
  }
});

app.put('/api/books/:id/progress', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const bookId = parseInt(req.params.id);
    const { progress, current_page } = req.body;
    await setUserReadingProgress(user.id, bookId, progress ?? 0, current_page ?? 0);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Per-User Favorites ──
app.get('/api/user/favorites', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.json({ bookIds: [] });
    const favBooks = await getUserFavorites(user.id);
    const bookIds = favBooks.map((b: any) => b.id || b.book_id);
    res.json({ bookIds });
  } catch {
    res.json({ bookIds: [] });
  }
});

app.post('/api/books/:id/favorite', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const bookId = parseInt(req.params.id);
    await addUserFavorite(user.id, bookId);
    res.json({ ok: true, favorite: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/:id/favorite', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const bookId = parseInt(req.params.id);
    await removeUserFavorite(user.id, bookId);
    res.json({ ok: true, favorite: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Per-User Reading Progress Map ──
app.get('/api/user/reading-map', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.json({ map: {} });

    // Use direct query to get all progress rows for this user
    if (isPostgres()) {
      const p = getPgPool();
      const result = await p.query(
        'SELECT book_id, progress, current_page, last_read FROM user_reading_progress WHERE user_id = $1 AND progress > 0',
        [user.id]
      );
      const map: Record<number, { progress: number; current_page: number; last_read: string }> = {};
      for (const row of result.rows) {
        map[row.book_id] = { progress: row.progress, current_page: row.current_page, last_read: row.last_read };
      }
      return res.json({ map });
    } else {
      // SQLite
      const { getDb: getSqliteDb } = await import('./database.js');
      const db = getSqliteDb();
      const rows = db.prepare(
        'SELECT book_id, progress, current_page, last_read FROM user_reading_progress WHERE user_id = ? AND progress > 0'
      ).all(user.id) as { book_id: number; progress: number; current_page: number; last_read: string }[];
      const map: Record<number, { progress: number; current_page: number; last_read: string }> = {};
      for (const row of rows) {
        map[row.book_id] = { progress: row.progress, current_page: row.current_page, last_read: row.last_read };
      }
      return res.json({ map });
    }
  } catch {
    res.json({ map: {} });
  }
});

// â”€â”€ Extract HTML from DOC/DOCX for Web Reader â”€â”€
// ── DOC/DOCX → PDF Conversion (LibreOffice headless) ──
import { convertDocToPdf, isLibreOfficeAvailable } from './docConverter.js';

// Check LibreOffice availability at startup
isLibreOfficeAvailable();

// ── Serve book files for the reader ──
const TUNNEL_URL = process.env.TUNNEL_URL || ''; // e.g. https://xyz.trycloudflare.com
const TUNNEL_SECRET = process.env.TUNNEL_SECRET || 'bv-tunnel-2026';

// ── Tunnel file endpoint (runs on LOCAL server, called by Render via tunnel) ──
app.get('/file', (req, res) => {
  const secret = req.query.secret as string;
  const filePath = req.query.path as string;

  if (secret !== TUNNEL_SECRET) {
    return res.status(403).json({ error: 'Invalid tunnel secret' });
  }

  if (!filePath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Security: only allow paths that look like book files
  if (filePath.includes('..') || filePath.includes('//')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on local disk' });
  }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    djvu: 'image/vnd.djvu',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp',
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${filePath.split(/[/\\]/).pop()}"`);
  const stream = createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', () => res.status(500).end());
});

// Helper: resolve a file path — local first, then via tunnel download to temp
import { tmpdir } from 'os';
import { createHash } from 'crypto';

async function resolveFilePath(filePath: string, bookId?: number): Promise<string | null> {
  // 1. Local file exists?
  if (existsSync(filePath)) return filePath;
  
  // 2. Check temp cache (avoid re-downloading)
  const hash = createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const ext = filePath.match(/\.([^.]+)$/)?.[1] || 'bin';
  const tempPath = join(tmpdir(), `bv_${hash}.${ext}`);
  if (existsSync(tempPath)) return tempPath;

  // 3. Try R2 (download to temp for text extraction)
  if (isR2Configured && bookId) {
    // Try multiple R2 keys: the file_path itself (for user uploads), then standard key
    const r2Keys: string[] = [];
    
    // For user uploads, file_path IS the r2 key (e.g. uploads/{userId}/{uuid}.pdf)
    if (filePath.startsWith('uploads/')) {
      r2Keys.push(filePath);
    }
    
    // Also try the r2_file_key from the book record
    try {
      const book = await getBookById(bookId) as any;
      if (book?.r2_file_key && !r2Keys.includes(book.r2_file_key)) {
        r2Keys.push(book.r2_file_key);
      }
    } catch {}
    
    // Standard key for library books
    r2Keys.push(`books/${bookId}.${ext}`);
    
    for (const r2Key of r2Keys) {
      const r2Data = await getR2Stream(r2Key);
      if (r2Data) {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of r2Data.stream as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          writeFileSync(tempPath, buffer);
          console.log(`📦 R2 → temp: ${Math.round(buffer.length/1024)}KB → ${tempPath} (key: ${r2Key})`);
          return tempPath;
        } catch (err: any) {
          console.error(`📦 R2 stream error:`, err.message);
        }
      }
    }
  }
  
  // 4. Try tunnel (legacy fallback)
  if (!TUNNEL_URL) return null;
  
  try {
    console.log(`📡 Tunnel download: ${filePath.slice(-60)}`);
    const tunnelFileUrl = `${TUNNEL_URL}/file?path=${encodeURIComponent(filePath)}&secret=${TUNNEL_SECRET}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    
    const tunnelRes = await fetch(tunnelFileUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!tunnelRes.ok) {
      console.error(`📡 Tunnel error ${tunnelRes.status} for: ${filePath.slice(-60)}`);
      return null;
    }
    
    const buffer = Buffer.from(await tunnelRes.arrayBuffer());
    writeFileSync(tempPath, buffer);
    console.log(`📡 Tunnel OK: ${Math.round(buffer.length/1024)}KB → ${tempPath}`);
    return tempPath;
  } catch (err: any) {
    console.error(`📡 Tunnel failed for ${filePath.slice(-60)}:`, err.message);
    return null;
  }
}

app.get('/api/books/:id/file', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  const filePath = book.file_path as string;

  const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();

  // ── DOC/DOCX: Convert to PDF via pdf-lib (pure JS) ──
  if (ext === 'doc' || ext === 'docx') {
    const resolvedDoc = await resolveFilePath(filePath, bookId);
    if (!resolvedDoc) return res.status(404).json({ error: 'DOC file not accessible' });

    const pdfPath = await convertDocToPdf(resolvedDoc, bookId);
    if (pdfPath && existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${(book.file_name as string || 'document').replace(/\.[^.]+$/, '.pdf')}"`);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(pdfPath);
    }
    return res.status(500).json({ error: 'No se pudo convertir el documento.' });
  }

  // 1. Try local file first (dev mode)
  if (existsSync(filePath)) {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf', epub: 'application/epub+zip',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
    };
    res.setHeader('Content-Type', mimeMap[ext || ''] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${book.file_name}"`);
    return res.sendFile(filePath);
  }

  // 2. Try R2 (production — stream from Cloudflare R2)
  const r2Key = (book as any).r2_file_key as string;
  if (isR2Configured && r2Key) {
    try {
      const r2Data = await getR2Stream(r2Key);
      if (r2Data) {
        res.setHeader('Content-Type', r2Data.contentType);
        res.setHeader('Content-Disposition', `inline; filename="${book.file_name}"`);
        if (r2Data.contentLength) res.setHeader('Content-Length', r2Data.contentLength);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        (r2Data.stream as NodeJS.ReadableStream).pipe(res);
        return;
      }
    } catch (err) {
      console.error('R2 stream error:', err);
    }
  }

  // 3. Fallback: Cloudflare Tunnel (legacy)
  if (TUNNEL_URL) {
    try {
      const tunnelFileUrl = `${TUNNEL_URL}/file?path=${encodeURIComponent(filePath)}&secret=${TUNNEL_SECRET}`;
      const tunnelRes = await fetch(tunnelFileUrl);
      if (!tunnelRes.ok) {
        return res.status(tunnelRes.status).json({ error: 'File not available via tunnel' });
      }
      res.setHeader('Content-Type', tunnelRes.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', tunnelRes.headers.get('content-disposition') || `inline; filename="${book.file_name}"`);
      const buffer = Buffer.from(await tunnelRes.arrayBuffer());
      return res.send(buffer);
    } catch (err) {
      console.error('Tunnel proxy error:', err);
      return res.status(502).json({ error: 'Tunnel unavailable' });
    }
  }

  res.status(404).json({ error: 'File not found' });
});

// â”€â”€ Cover serving (supports JPG from API/PDF and SVG fallback) â”€â”€
app.get('/api/books/:id/cover', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const serveImage = (path: string) => {
    const isSvg = path.endsWith('.svg');
    const isPng = path.endsWith('.png');
    const contentType = isSvg ? 'image/svg+xml' : isPng ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.sendFile(path, (err: any) => { if (err && !res.headersSent) res.status(404).json({ error: 'Cover not found' }); });
  };

  // 1. Try R2 cover first (production)
  const r2CoverKey = (book as any).r2_cover_key as string;
  if (isR2Configured && r2CoverKey) {
    const url = await getR2Url(r2CoverKey);
    if (url) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.redirect(url);
    }
  }

  // 2. Check existing cover_path (could be API jpg, PDF jpg, SVG, or Supabase URL)
  const coverPath = book.cover_path as string;
  if (coverPath && coverPath.startsWith('http')) {
    return res.redirect(coverPath);
  }
  if (coverPath && existsSync(coverPath)) {
    return serveImage(coverPath);
  }

  // 2. Check if a downloaded API cover exists
  const jpgPath = join(COVERS_DIR, `${bookId}.jpg`);
  const pngPath = join(COVERS_DIR, `${bookId}.png`);
  if (existsSync(jpgPath)) {
    await updateBook(bookId, { cover_path: jpgPath, cover_source: 'api' } as any);
    return serveImage(jpgPath);
  }
  if (existsSync(pngPath)) {
    await updateBook(bookId, { cover_path: pngPath, cover_source: 'api' } as any);
    return serveImage(pngPath);
  }

  // 3. Check if a PDF-extracted cover exists
  const pdfCoverPath = join(COVERS_DIR, `${bookId}_pdf.jpg`);
  if (existsSync(pdfCoverPath)) {
    await updateBook(bookId, { cover_path: pdfCoverPath, cover_source: 'pdf' } as any);
    return serveImage(pdfCoverPath);
  }

  // 4. Generate SVG fallback
  const originalFilePath = book.file_path as string;
  try {
    const newCoverPath = await generateCover(
      bookId, originalFilePath, book.title as string, book.author as string,
    );
    if (newCoverPath && existsSync(newCoverPath)) {
      await updateBook(bookId, { cover_path: newCoverPath, cover_source: 'svg' } as any);
      return serveImage(newCoverPath);
    }
  } catch (err) {
    console.error('Cover generation failed:', err);
  }

  res.status(204).end();
});

// â”€â”€ Text Extraction â”€â”€
app.get('/api/books/:id/text', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const origPath = book.file_path as string;
  const bookId = parseInt(req.params.id);
  const filePath = await resolveFilePath(origPath, bookId);
  if (!filePath) return res.status(404).json({ error: 'File not found' });

  const startPage = req.query.start ? parseInt(req.query.start as string) : undefined;
  const endPage = req.query.end ? parseInt(req.query.end as string) : undefined;

  // Route by format
  const ext = (origPath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  let result;
  if (ext === 'doc' || ext === 'docx') {
    result = await extractDocText(filePath, startPage, endPage);
  } else if (ext === 'epub') {
    result = await extractEpubText(filePath, startPage, endPage);
  } else {
    result = await extractPdfText(filePath, startPage, endPage);
  }
  res.json(result);
});

// â”€â”€ AI Summary Generation â”€â”€
app.post('/api/books/:id/summary', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const forceOcr = req.query.ocr === 'true';

  // Check if summary already exists (and we are not forcing a refresh)
  if (book.ai_summary && req.query.refresh !== 'true') {
    return res.json({ summary: book.ai_summary, cached: true });
  }

  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath, parseInt(req.params.id));
  if (!filePath) return res.status(404).json({ error: 'File not found' });

  try {
    let excerpt = '';

    if (forceOcr) {
      console.log(`ðŸ‘ï¸ Forcing OCR extraction for summary of "${book.title}"`);
      const { extractOcrText } = await import('./ocrExtractor.js');
      excerpt = await extractOcrText(filePath, 4);
    } else {
      // Normal extraction
      excerpt = await extractBookExcerpt(filePath, 3000);
      
      // Fallback to OCR if empty
      if (!excerpt || excerpt.length < 50) {
        console.log(`âš ï¸ Book "${book.title}" seems to be scanned. Running OCR for summary...`);
        try {
          const { extractOcrText } = await import('./ocrExtractor.js');
          excerpt = await extractOcrText(filePath, 4);
        } catch (ocrErr) {
          console.error('OCR fallback failed for summary:', ocrErr);
        }
      }
    }
    
    if (!excerpt || excerpt.length < 50) {
      return res.json({ summary: 'Este libro parece ser un escaneo de imÃ¡genes. No se pudo leer el texto ni siquiera con OCR.', cached: false });
    }

    // Ask LLM (Groq or Hermes) for a summary
    const llmOnline = await checkHermesHealth();
    if (!llmOnline) {
      return res.status(503).json({ error: 'AI no estÃ¡ disponible (ni Groq ni Hermes)' });
    }

    const summary = await llmComplete(
      'Eres un bibliotecario experto. Genera resÃºmenes concisos y Ãºtiles de libros. Responde en espaÃ±ol. El resumen debe tener 2-3 pÃ¡rrafos mÃ¡ximo.',
      `Genera un resumen del siguiente libro titulado "${book.title}":\n\n${excerpt}`,
      { temperature: 0.5, max_tokens: 500 },
    );

    if (!summary) {
      return res.status(500).json({ error: 'Error al generar resumen' });
    }

    // Save to DB
    await updateBook(parseInt(req.params.id), { ai_summary: summary } as any);

    res.json({ summary, cached: false });
  } catch (err) {
    console.error('Summary generation error:', err);
    res.status(500).json({ error: 'Error interno al generar resumen' });
  }
});

// â”€â”€ Categories â”€â”€
app.get('/api/categories', async (_req, res) => {
  res.json(await getCategories());
});

// â”€â”€ Collections â”€â”€
// Collections imported from db.js at top

app.get('/api/collections', optionalAuth, async (req, res) => {
  const collections = await getCollections(req.userId || null);
  res.json(collections);
});

// Get collections for a specific book
app.get('/api/books/:id/collections', optionalAuth, async (req, res) => {
  const collections = await getBookCollections(parseInt(req.params.id), req.userId || null);
  res.json(collections);
});

app.post('/api/collections', optionalAuth, async (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  // Create with user_id directly — no second UPDATE needed
  const id = await createCollection(name, description, color, req.userId || null);
  res.json({ id, name, description, color });
});

app.put('/api/collections/:id', optionalAuth, async (req, res) => {
  const { name, description, color } = req.body;
  // Only updates if owned by this user or legacy (NULL)
  await updateCollectionDb(parseInt(req.params.id), name, description, color, req.userId || null);
  res.json({ success: true });
});

app.delete('/api/collections/:id', optionalAuth, async (req, res) => {
  // Only deletes if owned by this user or legacy (NULL)
  await deleteCollectionDb(parseInt(req.params.id), req.userId || null);
  res.json({ success: true });
});

app.post('/api/collections/:id/books', optionalAuth, async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  await addBookToCollection(parseInt(bookId), parseInt(req.params.id));
  res.json({ success: true });
});

app.delete('/api/collections/:id/books/:bookId', optionalAuth, async (req, res) => {
  await removeBookFromCollection(parseInt(req.params.bookId), parseInt(req.params.id));
  res.json({ success: true });
});

// â”€â”€ Stats â”€â”€
app.get('/api/stats', optionalAuth, async (req, res) => {
  res.json(await getStats(req.userId || undefined));
});

// â”€â”€ Scan â”€â”€
app.post('/api/scan', async (_req, res) => {
  if (scanRunning) {
    return res.json({ status: 'already_running', progress: currentScan });
  }

  scanRunning = true;
  res.json({ status: 'started' });

  try {
    await scanLibrary(LIBRARY_PATH, (progress) => {
      currentScan = progress;
    });
  } catch (err) {
    console.error('Scan error:', err);
    if (currentScan) {
      currentScan.status = 'error';
      currentScan.errors.push(String(err));
    }
  } finally {
    scanRunning = false;
  }
});

app.get('/api/scan/status', async (_req, res) => {
  if (!currentScan) {
    return res.json({ status: 'idle', total: 0, processed: 0, newBooks: 0, skipped: 0 });
  }
  res.json(currentScan);
});

// â”€â”€ Health â”€â”€
app.get('/api/health', async (_req, res) => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  res.json({ status: 'ok', library: LIBRARY_PATH, ai: aiOnline, backend: isGroq ? 'groq' : 'hermes' });
});

// â”€â”€ AI Chat (Groq / Hermes proxy) â”€â”€

app.post('/api/ai/chat', optionalAuth, async (req, res) => {
  streamChat(req, res);
});

app.post('/api/organizer/chat', optionalAuth, async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] };
  
  // RAG Intermediary: Extract last user message to find relevant books
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  
  // Simple keyword extraction (remove common words)
  const keywords = lastUserMessage
    .replace(/[^\w\s\u00C0-\u017F]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 3)
    .join(' ');
    
  // Query local database for relevance
  let libraryContext = '';
  if (keywords) {
    const searchResult = await getAllBooks(20, 0, { search: keywords });
    if (searchResult.books.length > 0) {
      libraryContext = searchResult.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | TÃ­tulo: "${b.title}" | Autor: ${b.author || 'Desconocido'} | CategorÃ­a: ${b.category_name || 'Sin categorÃ­a'}\n  Sinopsis: ${b.ai_summary ? b.ai_summary.substring(0, 150) + '...' : 'Sin sinopsis'}`
      ).join('\n\n');
    }
  }

  // If no direct keyword match, provide a random sample of uncategorized books
  if (!libraryContext) {
    const uncategorized = await getAllBooks(10, 0, { category_id: 46 }); // 46 is usually 'Sin categorÃ­a'
    if (uncategorized.books.length > 0) {
      libraryContext = 'Libros recientes "Sin categorÃ­a" para organizar:\n' + uncategorized.books.map((b: any) => 
        `- ID [BOOK_ID:${b.id}] | TÃ­tulo: "${b.title}"`
      ).join('\n');
    }
  }

  // Inject library context into the request body for the hermes stream
  req.body.libraryContext = libraryContext;
  
  streamOrganizerChat(req, res);
});

app.get('/api/ai/health', async (_req, res) => {
  const online = await checkHermesHealth();
  res.json({ online });
});

// ── Web Search (for AI context enrichment) ──
app.post('/api/ai/search', async (req, res) => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  try {
    const results = await searchWeb(query.trim(), 5);
    const formatted = formatSearchResults(results);
    res.json({ results, formatted, count: results.length });
  } catch (err) {
    console.error('Web search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Bookmarks (Per-User) ──
app.get('/api/books/:id/bookmarks', optionalAuth, async (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const userId = req.userId || null;

    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bookmarks (
          id SERIAL PRIMARY KEY,
          book_id INTEGER NOT NULL,
          page INTEGER NOT NULL,
          label TEXT DEFAULT '',
          color TEXT DEFAULT '#667eea',
          user_id TEXT DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const { rows } = await pool.query(
        'SELECT * FROM bookmarks WHERE book_id = $1 AND (user_id = $2 OR user_id IS NULL) ORDER BY page ASC',
        [bookId, userId]
      );
      res.json(rows);
    } else {
      const db = (await import('./database.js')).getDb();
      const bookmarks = db.prepare(
        'SELECT * FROM bookmarks WHERE book_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY page ASC'
      ).all(bookId, userId);
      res.json(bookmarks);
    }
  } catch (err) {
    console.error('Bookmarks GET error:', err);
    res.json([]);
  }
});

// ── AI Chat History ──
app.get('/api/books/:id/ai-chat-history', optionalAuth, async (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const userId = req.userId || 'anonymous';

    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id SERIAL PRIMARY KEY,
          book_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          messages JSONB DEFAULT '[]',
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const { rows } = await pool.query(
        'SELECT messages FROM ai_conversations WHERE book_id = $1 AND user_id = $2',
        [bookId, userId]
      );
      res.json(rows[0] ? rows[0].messages : []);
    } else {
      const db = (await import('./database.js')).getDb();
      db.prepare(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          messages TEXT DEFAULT '[]',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      const row = db.prepare('SELECT messages FROM ai_conversations WHERE book_id = ? AND user_id = ?').get(bookId, userId) as any;
      res.json(row ? JSON.parse(row.messages) : []);
    }
  } catch (err) {
    console.error('Failed to get AI history:', err);
    res.json([]);
  }
});

app.post('/api/books/:id/ai-chat-history', optionalAuth, async (req, res) => {
  try {
    const bookId = parseInt(req.params.id);
    const userId = req.userId || 'anonymous';
    const { messages } = req.body;

    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id SERIAL PRIMARY KEY,
          book_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          messages JSONB DEFAULT '[]',
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (book_id, user_id)
        )
      `);
      await pool.query(`
        INSERT INTO ai_conversations (book_id, user_id, messages, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (book_id, user_id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = NOW()
      `, [bookId, userId, JSON.stringify(messages)]);
      res.json({ success: true });
    } else {
      const db = (await import('./database.js')).getDb();
      db.prepare(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          messages TEXT DEFAULT '[]',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (book_id, user_id)
        )
      `).run();
      db.prepare(`
        INSERT INTO ai_conversations (book_id, user_id, messages) 
        VALUES (?, ?, ?)
        ON CONFLICT(book_id, user_id) DO UPDATE SET messages=excluded.messages, updated_at=CURRENT_TIMESTAMP
      `).run(bookId, userId, JSON.stringify(messages));
      res.json({ success: true });
    }
  } catch (err) {
    console.error('Failed to save AI history:', err);
    res.status(500).json({ error: 'Failed to save AI history' });
  }
});

app.post('/api/books/:id/bookmarks', optionalAuth, async (req, res) => {
  const { page, label, color } = req.body as { page: number; label?: string; color?: string };
  if (!page || page < 1) return res.status(400).json({ error: 'Valid page number required' });

  try {
    const bookId = parseInt(req.params.id);
    const userId = req.userId || null;
    const bookmarkLabel = label || `Página ${page}`;
    const bookmarkColor = color || '#667eea';

    if (isPostgres()) {
      const pool = getPgPool();
      const { rows: existing } = await pool.query(
        'SELECT id FROM bookmarks WHERE book_id = $1 AND page = $2 AND (user_id = $3 OR ($3 IS NULL AND user_id IS NULL))',
        [bookId, page, userId]
      );
      if (existing.length > 0) return res.status(409).json({ error: 'Bookmark already exists for this page' });

      const { rows } = await pool.query(
        'INSERT INTO bookmarks (book_id, page, label, color, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [bookId, page, bookmarkLabel, bookmarkColor, userId]
      );
      res.json({ id: rows[0].id, page, label: bookmarkLabel, color: bookmarkColor });
    } else {
      const db = (await import('./database.js')).getDb();
      const existing = userId
        ? db.prepare('SELECT id FROM bookmarks WHERE book_id = ? AND page = ? AND user_id = ?').get(bookId, page, userId)
        : db.prepare('SELECT id FROM bookmarks WHERE book_id = ? AND page = ? AND user_id IS NULL').get(bookId, page);
      if (existing) return res.status(409).json({ error: 'Bookmark already exists for this page' });

      const result = db.prepare('INSERT INTO bookmarks (book_id, page, label, color, user_id) VALUES (?, ?, ?, ?, ?)').run(
        bookId, page, bookmarkLabel, bookmarkColor, userId
      );
      res.json({ id: result.lastInsertRowid, page, label: bookmarkLabel, color: bookmarkColor });
    }
  } catch (err) {
    console.error('Bookmark POST error:', err);
    res.status(500).json({ error: 'Error creating bookmark' });
  }
});

app.delete('/api/books/:id/bookmarks/:bookmarkId', optionalAuth, async (req, res) => {
  try {
    const bookmarkId = parseInt(req.params.bookmarkId);
    const bookId = parseInt(req.params.id);
    const userId = req.userId || null;

    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(
        'DELETE FROM bookmarks WHERE id = $1 AND book_id = $2 AND (user_id = $3 OR user_id IS NULL)',
        [bookmarkId, bookId, userId]
      );
    } else {
      const db = (await import('./database.js')).getDb();
      db.prepare(
        'DELETE FROM bookmarks WHERE id = ? AND book_id = ? AND (user_id = ? OR user_id IS NULL)'
      ).run(bookmarkId, bookId, userId);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Bookmark DELETE error:', err);
    res.status(500).json({ error: 'Error deleting bookmark' });
  }
});

// â”€â”€ Affiliate Links & Monetization â”€â”€
// Affiliate imports from db.js at top

// Get affiliate links for a book (public â€” shows buy options)
app.get('/api/books/:id/affiliate-links', optionalAuth, async (req, res) => {
  const links = await getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Add/update affiliate link for a book (admin only)
app.post('/api/books/:id/affiliate-links', requireAuth, async (req, res) => {
  const { platform, affiliate_url, price_estimate, currency } = req.body;
  if (!platform || !affiliate_url) {
    return res.status(400).json({ error: 'platform y affiliate_url son requeridos.' });
  }
  
  await upsertAffiliateLink(
    parseInt(req.params.id),
    platform,
    affiliate_url,
    price_estimate,
    currency || 'USD'
  );
  
  const links = await getAffiliateLinks(parseInt(req.params.id));
  res.json(links);
});

// Track a click on an affiliate link
app.post('/api/affiliate/click/:linkId', optionalAuth, async (req, res) => {
  await trackAffiliateClick(req.userId || null, parseInt(req.params.linkId));
  
  // Get the link URL to redirect
  try {
    if (isPostgres()) {
      const pool = getPgPool();
      const { rows } = await pool.query('SELECT affiliate_url FROM affiliate_links WHERE id = $1', [parseInt(req.params.linkId)]);
      if (rows.length > 0) {
        res.json({ redirect: rows[0].affiliate_url });
      } else {
        res.status(404).json({ error: 'Enlace no encontrado.' });
      }
    } else {
      const db = (await import('./database.js')).getDb();
      const link = db.prepare('SELECT affiliate_url FROM affiliate_links WHERE id = ?').get(parseInt(req.params.linkId)) as { affiliate_url: string } | undefined;
      if (link) {
        res.json({ redirect: link.affiliate_url });
      } else {
        res.status(404).json({ error: 'Enlace no encontrado.' });
      }
    }
  } catch (err) {
    console.error('Affiliate click error:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// Get affiliate analytics (admin)
app.get('/api/affiliate/stats', requireAuth, async (req, res) => {
  try {
    if (isPostgres()) {
      const pool = getPgPool();
      const totalClicks = (await pool.query('SELECT COUNT(*) as c FROM affiliate_clicks')).rows[0]?.c || 0;
      const clicksByPlatform = (await pool.query(`
        SELECT al.platform, COUNT(ac.id) as clicks
        FROM affiliate_clicks ac
        JOIN affiliate_links al ON al.id = ac.link_id
        GROUP BY al.platform ORDER BY clicks DESC
      `)).rows;
      const topBooks = (await pool.query(`
        SELECT b.title, b.author, al.platform, COUNT(ac.id) as clicks
        FROM affiliate_clicks ac
        JOIN affiliate_links al ON al.id = ac.link_id
        JOIN books b ON b.id = al.book_id
        GROUP BY b.title, b.author, al.platform ORDER BY clicks DESC LIMIT 10
      `)).rows;
      const recentClicks = (await pool.query(`
        SELECT ac.clicked_at, al.platform, b.title, u.display_name
        FROM affiliate_clicks ac
        JOIN affiliate_links al ON al.id = ac.link_id
        JOIN books b ON b.id = al.book_id
        LEFT JOIN users u ON u.id = ac.user_id
        ORDER BY ac.clicked_at DESC LIMIT 20
      `)).rows;
      res.json({ totalClicks, clicksByPlatform, topBooks, recentClicks });
    } else {
      const db = (await import('./database.js')).getDb();
      const totalClicks = (db.prepare('SELECT COUNT(*) as c FROM affiliate_clicks').get() as { c: number }).c;
      const clicksByPlatform = db.prepare(`
        SELECT al.platform, COUNT(ac.id) as clicks
        FROM affiliate_clicks ac JOIN affiliate_links al ON al.id = ac.link_id
        GROUP BY al.platform ORDER BY clicks DESC
      `).all();
      const topBooks = db.prepare(`
        SELECT b.title, b.author, al.platform, COUNT(ac.id) as clicks
        FROM affiliate_clicks ac JOIN affiliate_links al ON al.id = ac.link_id
        JOIN books b ON b.id = al.book_id
        GROUP BY al.book_id, al.platform ORDER BY clicks DESC LIMIT 10
      `).all();
      const recentClicks = db.prepare(`
        SELECT ac.clicked_at, al.platform, b.title, u.display_name
        FROM affiliate_clicks ac JOIN affiliate_links al ON al.id = ac.link_id
        JOIN books b ON b.id = al.book_id LEFT JOIN users u ON u.id = ac.user_id
        ORDER BY ac.clicked_at DESC LIMIT 20
      `).all();
      res.json({ totalClicks, clicksByPlatform, topBooks, recentClicks });
    }
  } catch (err) {
    console.error('Affiliate stats error:', err);
    res.json({ totalClicks: 0, clicksByPlatform: [], topBooks: [], recentClicks: [] });
  }
});

// â”€â”€ User Uploads â”€â”€
import { upload, uploadFileToR2, deleteFileFromR2, getMimeType } from './uploadStorage.js';
// Upload imports from db.js at top

// Files now served from R2 (no local static)

// List user's uploads
app.get('/api/uploads', requireAuth, async (req, res) => {
  const uploads = await getUserUploads(req.userId!);
  res.json(uploads);
});

// Upload a file -> R2 + create book record
app.post('/api/uploads', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId!) as any;
  const plan = user?.plan || 'free';
  const limit = plan === 'enterprise' ? 200 : plan === 'premium' ? 50 : 5;
  const currentCount = await countUserUploads(req.userId!);
  
  if (currentCount >= limit) {
    return res.status(403).json({ 
      error: `Limite de archivos alcanzado (${limit}). Elimina archivos existentes o mejora tu plan.` 
    });
  }

  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo excede el limite de 100 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Error al subir archivo.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibio ningun archivo.' });
    }

    try {
      const ext = (req.file.originalname.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || 'pdf';
      const uniqueId = uuidv4();
      const r2Key = `uploads/${req.userId}/${uniqueId}.${ext}`;
      const contentType = getMimeType(`.${ext}`);

      // Upload to R2 via stream from temp file
      const uploaded = await uploadFileToR2(req.file.path, r2Key, contentType);
      
      // Cleanup temp file
      try {
        if (existsSync(req.file.path)) {
          unlinkSync(req.file.path);
        }
      } catch (cleanupErr) {
        console.error('Failed to cleanup temp upload file:', cleanupErr);
      }

      if (!uploaded) {
        return res.status(500).json({ error: 'Error al subir archivo al almacenamiento.' });
      }

      // Create book record (private by default)
      const title = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
      console.log(`📚 Creating book record: "${title}" for user ${req.userId}`);
      const bookId = await insertUserBook({
        title,
        format: ext,
        file_path: r2Key,
        file_name: req.file.originalname,
        file_size: req.file.size,
        r2_file_key: r2Key,
        uploaded_by: req.userId!,
        visibility: 'private',
      });
      console.log(`📚 Book record created with ID: ${bookId}`);

      // Link in user_uploads table
      await insertUserUpload(
        req.userId!,
        bookId,
        req.file.originalname,
        r2Key,
        req.file.size
      );
      console.log(`📤 Upload linked: book ${bookId} → user ${req.userId}`);

      res.json({
        id: bookId,
        original_filename: req.file.originalname,
        r2_key: r2Key,
        file_size: req.file.size,
        visibility: 'private',
        title,
      });
    } catch (uploadErr) {
      console.error('❌ Upload processing failed:', uploadErr);
      res.status(500).json({ error: 'Error al procesar la subida.' });
    }
  });
});

// Delete an upload
app.delete('/api/uploads/:id', requireAuth, async (req, res) => {
  const uploads = await getUserUploads(req.userId!);
  const target = uploads.find((u: any) => u.id === parseInt(req.params.id));
  
  if (!target) {
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  }

  // Delete from R2
  const storagePath = (target as any).storage_path;
  if (storagePath && storagePath.startsWith('uploads/')) {
    await deleteFileFromR2(storagePath);
  }

  // Delete book record if linked
  const bookId = (target as any).book_id;
  if (bookId) {
    try {
      const pgPool = getPgPool();
      await pgPool.query('DELETE FROM books WHERE id = $1 AND uploaded_by = $2', [bookId, req.userId]);
    } catch (e) {
      console.error('Failed to delete book record:', e);
    }
  }

  // Delete upload record
  await deleteUserUpload(parseInt(req.params.id), req.userId!);
  
  res.json({ success: true });
});

// Share a user-uploaded book (sends to admin for approval)
app.post('/api/uploads/:bookId/share', requireAuth, async (req, res) => {
  const bookId = parseInt(req.params.bookId);
  const book = await getBookById(bookId) as any;
  if (!book || book.uploaded_by !== req.userId) {
    return res.status(403).json({ error: 'No tienes permiso para modificar este libro.' });
  }
  await updateBook(bookId, { visibility: 'pending' } as any);
  res.json({ success: true, visibility: 'pending', message: 'Tu libro sera revisado por un administrador.' });
});

// Admin: approve/reject shared books (with categorization)
app.post('/api/admin/uploads/:bookId/approve', requireAuth, requireAdmin, async (req, res) => {
  const bookId = parseInt(req.params.bookId);
  const { action, category_id, title } = req.body;
  
  if (action === 'approve') {
    const updates: any = { visibility: 'public' };
    if (category_id) updates.category_id = parseInt(category_id);
    if (title) updates.title = title;
    await updateBook(bookId, updates);
    await pgLogAdminAction(req.userId!, 'approve_book', 'book', bookId.toString(), { title, category_id });
    res.json({ success: true, visibility: 'public' });
  } else {
    await updateBook(bookId, { visibility: 'private' } as any);
    await pgLogAdminAction(req.userId!, 'reject_book', 'book', bookId.toString(), {});
    res.json({ success: true, visibility: 'private' });
  }
});


// ══════════════════════════════════════
//  Admin Panel Endpoints (Phase 16)
// ══════════════════════════════════════


// Admin: Dashboard stats
app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [stats, recentUsers, recentUploads] = await Promise.all([
      pgGetDashboardStats(),
      pgGetRecentUsers(5),
      pgGetRecentUploads(5),
    ]);
    res.json({ ...stats, recentUsers, recentUploads });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas.' });
  }
});

// Admin: List all users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const users = await pgGetAllUsersAdmin(search);
    res.json(users);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios.' });
  }
});

// Admin: Change user plan
app.post('/api/admin/users/:id/plan', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { plan, days } = req.body;
    const targetUser = await getUserById(req.params.id) as any;
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const updates: any = {};
    if (plan) {
      updates.plan = plan;
      if (plan === 'free') {
        updates.subscription_status = 'none';
        updates.subscription_end = null;
      }
    }
    if (days && parseInt(days) > 0) {
      const end = new Date();
      end.setDate(end.getDate() + parseInt(days));
      updates.plan = 'premium';
      updates.subscription_status = 'active';
      updates.subscription_start = new Date().toISOString();
      updates.subscription_end = end.toISOString();
    }

    await updateUser(req.params.id, updates);
    console.log(`⚙️ Admin changed plan for ${targetUser.email}: ${JSON.stringify(updates)}`);
    await pgLogAdminAction(req.userId!, 'change_plan', 'user', req.params.id, { email: targetUser.email, ...updates });
    res.json({ success: true, updates });
  } catch (err) {
    console.error('Admin plan change error:', err);
    res.status(500).json({ error: 'Error al cambiar plan.' });
  }
});

// Admin: Get pending books
app.get('/api/admin/books/pending', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const books = await pgGetPendingBooks();
    res.json(books);
  } catch (err) {
    console.error('Admin pending books error:', err);
    res.status(500).json({ error: 'Error al obtener libros pendientes.' });
  }
});

// Admin: Get active coupons
app.get('/api/admin/coupons', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const couponConfig = process.env.COUPON_CODES || '';
    const coupons = couponConfig.split(',').filter(Boolean).map(c => {
      const [code, days] = c.split(':');
      return { code: code?.trim(), days: parseInt(days) || 0 };
    }).filter(c => c.code && c.days > 0);
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cupones.' });
  }
});

// Admin: Delete a user
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUser = await getUserById(req.params.id) as any;
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Don't allow deleting yourself
    if (req.params.id === req.userId) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo.' });
    }

    await pgDeleteUser(req.params.id);
    await pgLogAdminAction(req.userId!, 'delete_user', 'user', req.params.id, { email: targetUser.email });
    console.log(`⚙️ Admin deleted user: ${targetUser.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Error al eliminar usuario.' });
  }
});

// Admin: Edit user fields
app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { display_name, email } = req.body;
    await pgAdminEditUser(req.params.id, { display_name, email });
    await pgLogAdminAction(req.userId!, 'edit_user', 'user', req.params.id, { display_name, email });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin edit user error:', err);
    res.status(500).json({ error: 'Error al editar usuario.' });
  }
});

// (Routes /api/books/my and /api/books/community moved above /api/books/:id)

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Production: Serve Frontend Static Files
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const DIST_DIR = join(__dirname, '..', '..', 'dist');
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: serve index.html for any non-API route
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/covers/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
  console.log('ðŸŒ Serving production frontend from', DIST_DIR);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Start Server
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.listen(PORT, async () => {
  const aiOnline = await checkHermesHealth();
  const isGroq = !!process.env.GROQ_API_KEY;
  console.log(`\nðŸ›ï¸  BiblioVault API running on http://localhost:${PORT}`);
  console.log(`ðŸ“š Library path: ${LIBRARY_PATH}`);
  console.log(`ðŸ¤– AI Backend: ${isGroq ? 'Groq Cloud' : 'Local Hermes'} â€” ${aiOnline ? 'âœ… Online' : 'âš ï¸ Offline'}`);
  console.log(`ðŸ“Š Endpoints ready\n`);
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Enrichment Endpoints
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Enrich a single book
app.post('/api/books/:id/enrich', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  try {
    const result = await enrichBook(
      parseInt(req.params.id),
      book.file_name as string,
      book.author as string,
      book.file_path as string,
    );

    if (result.found) {
      // Update database with enrichment data
      const updates: Record<string, unknown> = {
        enriched: 1,
        enrichment_source: result.source,
      };

      if (result.title) {
        updates.original_title = book.title; // Keep original
        updates.title = result.title;
      }
      if (result.author) updates.author = result.author;
      if (result.description) updates.description = result.description;
      if (result.isbn) updates.isbn = result.isbn;
      if (result.pages && (book.pages as number) === 0) updates.pages = result.pages;
      if (result.coverPath) {
        updates.cover_path = result.coverPath;
        updates.cover_source = 'api';
      }

      await updateBook(parseInt(req.params.id), updates as any);
    } else {
      // Mark as enriched (attempted) even if not found
      await updateBook(parseInt(req.params.id), { enriched: 1 } as any);
    }

    res.json(result);
  } catch (err) {
    console.error('Enrichment failed:', err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

// Batch enrich all un-enriched books
app.post('/api/enrich/batch', async (_req, res) => {
  const state = getBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }

  resetBatchState();
  const books = getUnenrichedBooks();

  // Start in background
  runBatchEnrichment(books, async (bookId, result) => {
    const updates: Record<string, unknown> = {
      enriched: 1,
      enrichment_source: result.source,
    };

    if (result.title) {
      const book = await getBookById(bookId) as Record<string, unknown>;
      updates.original_title = book?.title || '';
      updates.title = result.title;
    }
    if (result.author) updates.author = result.author;
    if (result.description) updates.description = result.description;
    if (result.isbn) updates.isbn = result.isbn;
    if (result.pages) updates.pages = result.pages;
    if (result.coverPath) {
      updates.cover_path = result.coverPath;
      updates.cover_source = 'api';
    }

    await updateBook(bookId, updates as any);
  });

  res.json({ message: 'Batch enrichment started', total: books.length });
});

// Get enrichment status
app.get('/api/enrich/status', async (_req, res) => {
  res.json(getBatchState());
});

// Cancel batch enrichment
app.post('/api/enrich/cancel', async (_req, res) => {
  cancelBatchEnrichment();
  res.json({ message: 'Cancelled' });
});

// Helper to upload an extracted cover to R2 and Supabase
async function uploadCoverToCloudAndGetUrl(bookId: number, localCoverPath: string): Promise<{ finalCoverPath: string, r2CoverKey: string }> {
  let finalCoverPath = localCoverPath;
  let r2CoverKey = '';

  if (!existsSync(localCoverPath)) return { finalCoverPath, r2CoverKey };

  // Upload to R2 if configured (primary — persists across restarts)
  if (isR2Configured) {
    try {
      const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT!,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      });
      const ext = localCoverPath.split('.').pop()?.toLowerCase() || 'jpg';
      r2CoverKey = `covers/${bookId}.${ext}`;
      const coverBuffer = readFileSync(localCoverPath);
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET || 'bibliovault-books',
        Key: r2CoverKey,
        Body: coverBuffer,
        ContentType: 'image/jpeg',
      }));
      console.log(`📦 Cover uploaded to R2: ${r2CoverKey}`);
    } catch (r2Err) {
      console.error('R2 cover upload failed:', r2Err);
      r2CoverKey = '';
    }
  }

  // Also upload to Supabase Storage (legacy fallback)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);
      const coverBuffer = readFileSync(localCoverPath);
      const coverFilename = `${bookId}_pdf.jpg`;
      
      const { data, error } = await supabase.storage.from('covers').upload(coverFilename, coverBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      
      if (error) {
        console.error('❌ Supabase upload returned error:', error);
      } else {
        finalCoverPath = `${supabaseUrl}/storage/v1/object/public/covers/${coverFilename}`;
        console.log(`📸 Cover uploaded to Supabase: ${coverFilename}`);
      }
    } catch (uploadErr) {
      console.error('Supabase cover upload failed, using local path:', uploadErr);
    }
  }

  return { finalCoverPath, r2CoverKey };
}

app.get('/api/covers/test-supabase', async (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return res.json({ success: false, error: 'Supabase credentials missing from .env' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.storage.from('covers').upload('test.txt', 'test content', {
      upsert: true
    });
    
    if (error) {
      return res.json({ success: false, error: error.message || error });
    }
    
    res.json({ success: true, data });
  } catch (err: any) {
    res.json({ success: false, error: err.message || err });
  }
});

// Extract PDF first page as cover image
app.post('/api/books/:id/extract-cover', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  if (book.format !== 'pdf' && book.format !== 'epub' && book.format !== 'doc' && book.format !== 'docx') {
    return res.status(400).json({ error: 'Only PDF, EPUB, and DOC books supported for cover extraction' });
  }

  try {
    // Resolve file path (local or via tunnel)
    const filePath = await resolveFilePath(book.file_path as string, bookId);
    if (!filePath) return res.status(404).json({ error: 'File not accessible' });

    let coverPath: string | null = null;
    let source = '';

    if (book.format === 'pdf') {
      coverPath = await extractPdfCover(filePath, bookId);
      source = 'pdf';
    } else if (book.format === 'epub') {
      coverPath = await extractEpubCover(filePath, bookId);
      source = 'epub';
    } else if (book.format === 'doc' || book.format === 'docx') {
      // Convert DOC to PDF first, then extract cover from the PDF
      const pdfPath = await convertDocToPdf(filePath, bookId);
      if (pdfPath) {
        coverPath = await extractPdfCover(pdfPath, bookId);
      }
      source = 'doc';
    }

    if (coverPath && existsSync(coverPath)) {
      const { finalCoverPath, r2CoverKey } = await uploadCoverToCloudAndGetUrl(bookId, coverPath);

      const updateData: any = {
        cover_path: finalCoverPath,
        cover_source: source,
      };
      if (r2CoverKey) updateData.r2_cover_key = r2CoverKey;

      await updateBook(bookId, updateData);
      res.json({ success: true, coverPath: finalCoverPath });
    } else {
      res.json({ success: false, message: 'Could not extract cover' });
    }
  } catch (err) {
    console.error('PDF cover extraction failed:', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// â”€â”€ Batch Cover Extraction â”€â”€

// Start batch cover extraction for all books with SVG placeholders
app.post('/api/covers/batch', async (_req, res) => {
  const state = getCoverBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }

  resetCoverBatchState();
  const books = getBooksWithoutCovers();

  // Start in background
  runBatchCoverExtraction(books, async (bookId, coverPath, source) => {
    // Make sure we upload to cloud so it persists across Render restarts
    const { finalCoverPath, r2CoverKey } = await uploadCoverToCloudAndGetUrl(bookId, coverPath);
    
    const updateData: any = {
      cover_path: finalCoverPath,
      cover_source: source,
    };
    if (r2CoverKey) updateData.r2_cover_key = r2CoverKey;

    await updateBook(bookId, updateData);
  });

  res.json({ message: 'Batch cover extraction started', total: books.length });
});

// Get batch cover extraction status
app.get('/api/covers/batch/status', async (_req, res) => {
  res.json(getCoverBatchState());
});

// Cancel batch cover extraction
app.post('/api/covers/batch/cancel', async (_req, res) => {
  cancelCoverBatchJob();
  res.json({ message: 'Cancelled' });
});

// AI Title Identification with Vision AI fallback
app.post('/api/books/:id/identify-title', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const book = await getBookById(bookId) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const origPath = book.file_path as string;
  const filePath = await resolveFilePath(origPath, bookId) || origPath;
  const ext = (origPath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

  try {
    let result = null;

    if (ext === 'pdf') {
      let coverImagePath: string | undefined;
      const coverPath = book.cover_path as string;
      
      if (coverPath && !coverPath.startsWith('http') && existsSync(coverPath)) {
        coverImagePath = coverPath;
      } else {
        try {
          const extracted = await extractPdfCover(filePath, bookId);
          if (extracted && existsSync(extracted)) coverImagePath = extracted;
        } catch { /* ignore */ }
      }

      result = await identifyTitleFromPdf(filePath, book.title as string, coverImagePath);
    } else {
      const { identifyTitleFromFilename } = await import('./aiTitleIdentifier.js');
      result = await identifyTitleFromFilename(
        book.title as string,
        book.file_name as string,
        book.folder_category as string || '',
      );
    }

    if (result && result.confidence !== 'low') {
      res.json({ success: true, ...result });
    } else {
      res.json({
        success: false,
        message: result ? 'Low confidence identification' : 'No se pudo leer el texto del archivo',
        ...result,
      });
    }
  } catch (err) {
    console.error('AI title identification failed:', err);
    res.status(500).json({ error: 'Identification failed' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Full-Text Search (Phase 8)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Global full-text search across all books
app.get('/api/search/fulltext', async (req, res) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const limit = parseInt(req.query.limit as string) || 50;
  const results = await searchFullText(q, limit);
  res.json({ results, query: q });
});

// Search within a specific book
app.get('/api/books/:id/search', async (req, res) => {
  const bookId = parseInt(req.params.id);
  const q = req.query.q as string;
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = await searchInBook(bookId, q);
  res.json({ results, query: q });
});

// Index a single book
app.post('/api/books/:id/index', async (req, res) => {
  const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (book.format !== 'pdf') return res.json({ indexed: 0, message: 'Only PDFs can be indexed' });
  const pages = await indexBookText(parseInt(req.params.id), book.file_path as string);
  res.json({ indexed: pages });
});

// Batch index all PDFs
app.post('/api/search/index/batch', async (_req, res) => {
  const state = getIndexBatchState();
  if (state.status === 'running') {
    return res.json({ message: 'Already running', ...state });
  }
  resetIndexBatchState();
  runBatchIndexing(); // Fire and forget
  res.json({ message: 'Indexing started' });
});

// Batch index status
app.get('/api/search/index/status', async (_req, res) => {
  res.json(getIndexBatchState());
});

// Cancel batch indexing
app.post('/api/search/index/cancel', async (_req, res) => {
  cancelIndexBatch();
  res.json({ message: 'Cancelled' });
});

// Index stats
app.get('/api/search/index/stats', async (_req, res) => {
  res.json(await getIndexStats());
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  Fase 9: Statistics, Export & Backup
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Extended statistics for the Dashboard
app.get('/api/stats/extended', optionalAuth, async (req, res) => {
  try {
    const result = await getAllBooks(10000, 0) as { books: Array<Record<string, any>>; total: number };
    const allBooks = result.books || [];
    
    const totalBooks = allBooks.length;
    const totalPages = allBooks.reduce((sum, b) => sum + (b.pages || 0), 0);

    let completedBooks = 0;
    let totalPagesRead = 0;
    let booksInProgress = 0;
    const readingMap: Record<number, number> = {};

    const categories = await getCategories() as Array<Record<string, any>>;
    const catMap = new Map<number, string>();
    categories.forEach(c => catMap.set(c.id, c.name));

    let recentlyRead: Array<{ title: string; progress: number; lastRead: string; pages: number; format: string }> = [];
    let userCategoryStats: Array<{ name: string; value: number }> = [];
    let progressBreakdown: Array<{ name: string; value: number }> = [];
    let leaderboard: Array<{ name: string; pagesRead: number; booksRead: number; isCurrentUser: boolean }> = [];

    if (isPostgres()) {
      const p = getPgPool();

      if (req.userId) {
        const progressRows = await p.query(
          'SELECT book_id, progress FROM user_reading_progress WHERE user_id = $1 AND progress > 0',
          [req.userId]
        );
        for (const row of progressRows.rows) {
          readingMap[row.book_id] = row.progress;
        }
        completedBooks = progressRows.rows.filter((r: any) => r.progress >= 0.99).length;
        booksInProgress = progressRows.rows.filter((r: any) => r.progress > 0 && r.progress < 0.99).length;
        totalPagesRead = Math.round(
          allBooks.reduce((acc, b) => {
            const progress = readingMap[b.id] || 0;
            return acc + ((b.pages || 0) * progress);
          }, 0)
        );

        const recentRows = await p.query(`
          SELECT b.title, b.pages, b.format, urp.progress, urp.last_read
          FROM user_reading_progress urp
          JOIN books b ON b.id = urp.book_id
          WHERE urp.user_id = $1 AND urp.progress > 0
          ORDER BY urp.last_read DESC
          LIMIT 10
        `, [req.userId]);
        recentlyRead = recentRows.rows.map((r: any) => ({
          title: r.title,
          progress: r.progress,
          lastRead: r.last_read,
          pages: r.pages || 0,
          format: r.format || 'unknown',
        }));

        const userCatRows = await p.query(`
          SELECT COALESCE(c.name, 'Sin categoría') as name, COUNT(*) as cnt
          FROM user_reading_progress urp
          JOIN books b ON b.id = urp.book_id
          LEFT JOIN categories c ON b.category_id = c.id
          WHERE urp.user_id = $1 AND urp.progress > 0
          GROUP BY c.name
          ORDER BY cnt DESC
          LIMIT 5
        `, [req.userId]);
        userCategoryStats = userCatRows.rows.map((r: any) => ({
          name: r.name,
          value: parseInt(r.cnt),
        }));

        // Progress breakdown for pie chart
        const pbRows = await p.query(`
          SELECT 
            CASE 
              WHEN progress >= 0.99 THEN 'Completados'
              WHEN progress >= 0.5 THEN 'Avanzados'
              WHEN progress >= 0.1 THEN 'En Progreso'
              ELSE 'Recién Empezados'
            END as name,
            COUNT(*) as cnt
          FROM user_reading_progress
          WHERE user_id = $1 AND progress > 0
          GROUP BY name
          ORDER BY MIN(progress) DESC
        `, [req.userId]);
        progressBreakdown = pbRows.rows.map((r: any) => ({
          name: r.name,
          value: parseInt(r.cnt),
        }));
      }

      const leaderRows = await p.query(`
        SELECT 
          u.id,
          COALESCE(u.display_name, split_part(u.email, '@', 1)) as name,
          COALESCE(SUM(ROUND(COALESCE(b.pages, 0) * urp.progress)), 0) as pages_read,
          COUNT(CASE WHEN urp.progress > 0 THEN 1 END) as books_read
        FROM users u
        LEFT JOIN user_reading_progress urp ON urp.user_id = u.id AND urp.progress > 0
        LEFT JOIN books b ON b.id = urp.book_id
        GROUP BY u.id, u.display_name, u.email
        HAVING COUNT(CASE WHEN urp.progress > 0 THEN 1 END) > 0
        ORDER BY pages_read DESC
        LIMIT 10
      `);
      leaderboard = leaderRows.rows.map((r: any) => ({
        name: r.name,
        pagesRead: parseInt(r.pages_read) || 0,
        booksRead: parseInt(r.books_read) || 0,
        isCurrentUser: req.userId === r.id,
      }));
    }

    res.json({
      totalBooks,
      totalPages,
      completedBooks,
      booksInProgress,
      totalPagesRead,
      progressBreakdown,
      categoryStats: userCategoryStats,
      recentlyRead,
      leaderboard,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch extended stats' });
  }
});

// Export library as CSV
app.get('/api/export/csv', async (_req, res) => {
  try {
    const result = await getAllBooks(10000, 0) as { books: Array<Record<string, any>>; total: number };
    const allBooks = result.books || [];
    const categories = await getCategories() as Array<Record<string, any>>;
    const catMap = new Map<number, string>();
    categories.forEach(c => catMap.set(c.id, c.name));

    if (allBooks.length === 0) {
      return res.status(404).send('No books to export');
    }

    const headers = ['id', 'title', 'author', 'isbn', 'format', 'pages', 'category', 'reading_progress', 'date_added'];
    const rows = allBooks.map(b => {
      const values = [
        b.id, b.title, b.author, b.isbn, b.format, b.pages,
        catMap.get(b.category_id) || '', b.reading_progress, b.date_added
      ];
      return values.map(v => {
        if (v === null || v === undefined) return '""';
        const str = String(v).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });

    const csvStr = headers.join(',') + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bibliovault_export.csv"');
    res.send(csvStr);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).send('Failed to export CSV');
  }
});

// Download DB Backup
import { DB_PATH } from './database.js';

app.get('/api/backup', async (_req, res) => {
  if (existsSync(DB_PATH)) {
    // res.download needs absolute path, which DB_PATH is.
    res.download(DB_PATH, 'bibliovault.db', (err) => {
      if (err) console.error('Backup download error:', err);
    });
  } else {
    res.status(404).send('Database not found');
  }
});

// ============================================
//  Community & Forums (Phase 15)
// ============================================

// List all public communities
app.get('/api/communities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const communities = await getCommunities(limit, offset);
    res.json(communities);
  } catch (err) {
    console.error('Communities list error:', err);
    res.status(500).json({ error: 'Failed to load communities' });
  }
});

// Get user's communities
app.get('/api/communities/mine', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const communities = await getUserCommunities(user.id);
    res.json(communities);
  } catch (err) {
    console.error('My communities error:', err);
    res.status(500).json({ error: 'Failed to load communities' });
  }
});

// Book forums (communities linked to books)
app.get('/api/communities/books', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const communities = await getBookCommunities(limit, offset);
    res.json(communities);
  } catch (err) {
    console.error('Book communities error:', err);
    res.status(500).json({ error: 'Failed to load book forums' });
  }
});

// Official forums only
app.get('/api/communities/official', async (_req, res) => {
  try {
    const communities = await getOfficialCommunities();
    res.json(communities);
  } catch (err) {
    console.error('Official communities error:', err);
    res.status(500).json({ error: 'Failed to load official forums' });
  }
});

// Global activity feed — recent threads from all communities
app.get('/api/threads/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 30;
    const threads = await getRecentThreadsGlobal(limit);
    res.json(threads);
  } catch (err) {
    console.error('Recent threads error:', err);
    res.status(500).json({ error: 'Failed to load recent threads' });
  }
});

// Get community by slug
app.get('/api/communities/:slug', async (req, res) => {
  try {
    const community = await getCommunityBySlug(req.params.slug);
    if (!community) return res.status(404).json({ error: 'Community not found' });

    const user = await getAuthenticatedUser(req);
    const membership = user ? await getMemberRole(community.id, user.id) : null;

    res.json({ ...community, user_role: membership });
  } catch (err) {
    console.error('Community detail error:', err);
    res.status(500).json({ error: 'Failed to load community' });
  }
});

// Create community
app.post('/api/communities', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { name, description, rules, type } = req.body;
    if (!name || name.length < 3) return res.status(400).json({ error: 'Name too short' });

    const community = await createCommunity(name, description || '', rules || '', type || 'public', user.id);
    res.json(community);
  } catch (err) {
    console.error('Create community error:', err);
    res.status(500).json({ error: 'Failed to create community' });
  }
});

// Update community
app.put('/api/communities/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const communityId = parseInt(req.params.id);
    const role = await getMemberRole(communityId, user.id);
    if (!role || (role !== 'creator' && role !== 'moderator')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await updateCommunity(communityId, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('Update community error:', err);
    res.status(500).json({ error: 'Failed to update community' });
  }
});

// Join community
app.post('/api/communities/:id/join', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    await joinCommunity(parseInt(req.params.id), user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Join error:', err);
    res.status(500).json({ error: 'Failed to join' });
  }
});

// Leave community
app.post('/api/communities/:id/leave', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const left = await leaveCommunity(parseInt(req.params.id), user.id);
    res.json({ success: left });
  } catch (err) {
    console.error('Leave error:', err);
    res.status(500).json({ error: 'Failed to leave' });
  }
});

// Get community members
app.get('/api/communities/:id/members', async (req, res) => {
  try {
    const members = await getCommunityMembers(parseInt(req.params.id));
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// Get/create book community (auto-create)
app.get('/api/books/:id/community', async (req, res) => {
  try {
    const book = await getBookById(parseInt(req.params.id)) as Record<string, unknown> | undefined;
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const community = await getOrCreateBookCommunity(book.id as number, book.title as string);
    const user = await getAuthenticatedUser(req);
    const membership = user ? await getMemberRole(community.id, user.id) : null;

    res.json({ ...community, user_role: membership });
  } catch (err) {
    console.error('Book community error:', err);
    res.status(500).json({ error: 'Failed to load book community' });
  }
});

// ── Threads ──

// List threads in a community
app.get('/api/communities/:id/threads', async (req, res) => {
  try {
    const sort = (req.query.sort as string) || 'recent';
    const limit = parseInt(req.query.limit as string) || 30;
    const offset = parseInt(req.query.offset as string) || 0;
    const threads = await getThreads(parseInt(req.params.id), sort, limit, offset);

    // Include user votes if authenticated
    const user = await getAuthenticatedUser(req);
    let userVotes: Record<number, number> = {};
    if (user && threads.length > 0) {
      userVotes = await getUserVotes(user.id, 'thread', threads.map((t: any) => t.id));
    }

    res.json({ threads, userVotes });
  } catch (err) {
    console.error('Threads list error:', err);
    res.status(500).json({ error: 'Failed to load threads' });
  }
});

// Get single thread with replies
app.get('/api/threads/:id', async (req, res) => {
  try {
    const thread = await getThread(parseInt(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const replies = await getReplies(thread.id);
    const user = await getAuthenticatedUser(req);

    let userVotes: Record<number, number> = {};
    if (user && replies.length > 0) {
      userVotes = await getUserVotes(user.id, 'reply', replies.map((r: any) => r.id));
    }

    res.json({ thread, replies, userVotes });
  } catch (err) {
    console.error('Thread detail error:', err);
    res.status(500).json({ error: 'Failed to load thread' });
  }
});

// Create thread
app.post('/api/communities/:id/threads', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { title, content, hasSpoilers } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });

    const thread = await createThread(parseInt(req.params.id), user.id, title, content, hasSpoilers);
    res.json(thread);
  } catch (err: any) {
    if (err.message?.startsWith('Contenido bloqueado')) {
      return res.status(403).json({ error: err.message });
    }
    console.error('Create thread error:', err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// Update/pin/lock thread
app.put('/api/threads/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const thread = await getThread(parseInt(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Not found' });

    // Only author or moderator can edit
    const role = await getMemberRole(thread.community_id, user.id);
    if (thread.user_id !== user.id && (!role || !['creator', 'moderator'].includes(role))) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await updateThread(thread.id, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('Update thread error:', err);
    res.status(500).json({ error: 'Failed to update thread' });
  }
});

// Delete thread
app.delete('/api/threads/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const thread = await getThread(parseInt(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Not found' });

    const role = await getMemberRole(thread.community_id, user.id);
    if (thread.user_id !== user.id && (!role || !['creator', 'moderator'].includes(role))) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await deleteThread(thread.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

// ── Replies ──

app.post('/api/threads/:id/replies', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { content, parentReplyId } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const reply = await createReply(parseInt(req.params.id), user.id, content, parentReplyId);
    res.json(reply);
  } catch (err: any) {
    if (err.message?.startsWith('Contenido bloqueado')) {
      return res.status(403).json({ error: err.message });
    }
    console.error('Create reply error:', err);
    res.status(500).json({ error: 'Failed to create reply' });
  }
});

app.delete('/api/replies/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    // For simplicity, only moderators or reply owner can delete
    await deleteReply(parseInt(req.params.id), parseInt(req.query.threadId as string));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reply' });
  }
});

// ── Votes ──

app.post('/api/votes', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { targetType, targetId, value } = req.body;
    if (!targetType || !targetId || ![1, -1].includes(value)) {
      return res.status(400).json({ error: 'Invalid vote' });
    }

    const result = await vote(user.id, targetType, targetId, value);
    res.json(result);
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// Sentry Error Handler (must be after all controllers)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

