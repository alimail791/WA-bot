// All settings come from environment variables. See .env.example.
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/$/, ''),
  secret: env.APP_SECRET || 'dev-secret-change-me',

  // Storage: "mongo" (production) or "memory" (local testing)
  store: env.STORE || (env.MONGODB_URI ? 'mongo' : 'memory'),
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'wa_engine',

  // WhatsApp provider: "meta" (Meta Cloud API format, also used by AiSensy Direct API / 360dialog) or "sim"
  provider: env.PROVIDER || (env.WA_TOKEN ? 'meta' : 'sim'),
  wa: {
    apiBase: (env.WA_API_BASE || 'https://graph.facebook.com/v21.0').replace(/\/$/, ''),
    token: env.WA_TOKEN || '',
    verifyToken: env.WA_VERIFY_TOKEN || 'verify-me',
    appSecret: env.WA_APP_SECRET || '', // checks X-Hub-Signature-256 when set
    // Each product can have its own number. Map phone_number_id -> product key.
    numbers: {
      yneet: env.WA_PHONE_ID_YNEET || '',
      testmandi: env.WA_PHONE_ID_TESTMANDI || '',
      classcoach: env.WA_PHONE_ID_CLASSCOACH || '',
    },
    // If you run all three products on ONE number, set this; users pick a product from a menu.
    sharedNumberId: env.WA_PHONE_ID_SHARED || '',
    // Business display numbers (for wa.me share links), digits only with country code.
    // Default: all three products share Raise Academy's verified number.
    displayNumbers: {
      yneet: env.WA_DISPLAY_YNEET || env.WA_DISPLAY_SHARED || '919443424064',
      testmandi: env.WA_DISPLAY_TESTMANDI || env.WA_DISPLAY_SHARED || '919443424064',
      classcoach: env.WA_DISPLAY_CLASSCOACH || env.WA_DISPLAY_SHARED || '919443424064',
    },
    businessName: env.WA_BUSINESS_NAME || 'Raise Academy',
  },

  // AiSensy Campaign API (template messages only)
  aisensy: {
    apiKey: env.AISENSY_API_KEY || '',
    url: env.AISENSY_CAMPAIGN_URL || 'https://backend.aisensy.com/campaign/t1/api/v2',
  },

  // Payments: Razorpay Payment Links. Without keys, a dev payment page is used.
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  // Optional: a real deadline for a limited-time offer, e.g. 2026-11-30. Leave empty for no offer.
  offerEndsOn: env.OFFER_ENDS_ON || '',

  adminKey: env.ADMIN_KEY || 'admin-dev-key',
  enableCron: env.ENABLE_CRON !== 'false',
};
