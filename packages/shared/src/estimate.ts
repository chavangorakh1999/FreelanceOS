import { divRound, money, Money, parseMoney, toDecimalString } from './money';

/**
 * Project estimates from researched hour ranges.
 *
 * Every catalogue item carries a low, likely and high figure in hours, and the sources those came from. Where no published
 * figure exists the item says so (source `rule`), so nobody mistakes a rule of thumb for research. Hours are kept in half
 * hours (integers) and money in minor units (bigint), so the same inputs always give the same, exact answer.
 */

export const ESTIMATE_SOURCES = {
  abbacus: { title: 'Abbacus Technologies: how many hours to build a website', url: 'https://www.abbacustechnologies.com/how-many-hours-to-build-a-website/' },
  itexus: { title: 'Itexus: website development cost breakdown', url: 'https://itexus.com/website-development-cost-breakdown/' },
  fireart: { title: 'Fireart: web design and development cost', url: 'https://fireart.studio/blog/how-to-calculate-web-design-and-website-development-cost/' },
  intellectsoft: { title: 'Intellectsoft: web development cost guide', url: 'https://www.intellectsoft.net/blog/website-development-cost/' },
  volts: { title: 'Volts Consulting: web app development cost', url: 'https://voltsconsulting.com/web-app-development-cost/' },
  pce: { title: 'Project Cost Estimator: freelance website cost', url: 'https://projectcostestimator.com/freelance-website-cost' },
  pceFeatures: { title: 'Project Cost Estimator: cost of 41 features', url: 'https://projectcostestimator.com/feature-cost-breakdown' },
  netguru: { title: 'Netguru: mobile app development cost', url: 'https://www.netguru.com/blog/mobile-app-development-cost' },
  upwork: { title: 'Upwork: cost to build a mobile app', url: 'https://www.upwork.com/resources/cost-build-mobile-app' },
  litslink: { title: 'Litslink: mobile app development cost', url: 'https://litslink.com/blog/mobile-app-development-cost' },
  techsy: { title: 'Techsy: mobile app cost', url: 'https://techsy.io/en/blog/mobile-app-cost' },
  deepsel: { title: 'Deepsel: app development cost, ranges and hours', url: 'https://deepsel.com/app-development-cost/' },
  nerdify: { title: 'Nerdify: mobile app cost calculator guide', url: 'https://getnerdify.com/blog/mobile-app-development-cost-calculator/' },
  onix: { title: 'Onix: mobile app development cost breakdown', url: 'https://onix-systems.com/blog/how-much-does-mobile-app-development-cost' },
  dbbEcom: { title: 'DBB Software: e-commerce website development cost', url: 'https://dbbsoftware.com/insights/ecommerce-website-development-cost' },
  abbacusEcom: { title: 'Abbacus Technologies: cost to develop an e-commerce store', url: 'https://www.abbacustechnologies.com/how-much-does-it-cost-to-develop-an-ecommerce-store/' },
  topflight: { title: 'Topflight: how long it takes to develop an app', url: 'https://topflightapps.com/ideas/how-long-does-it-take-to-develop-an-app/' },
  kultrix: { title: 'Kultrix: app development time and cost', url: 'https://kultrix.com/blog/app-development-cost-timeline' },
  glance: { title: 'Glance: cross-platform vs native development time', url: 'https://thisisglance.com/learning-centre/how-long-does-cross-platform-development-take-compared-to-native' },
  chopdawg: { title: 'Chop Dawg: native vs cross-platform trade-offs', url: 'https://www.chopdawg.com/native-vs-cross-platform-app-development-in-2026-the-real-tradeoffs/' },
  contingency: { title: 'DesignRush: planning a software budget (10 to 20% contingency)', url: 'https://www.designrush.com/agency/software-development/trends/software-development-budget' },
  qsm: { title: 'QSM: quantifying software project risk', url: 'https://qsm.com/blog/2024/quantifying-and-managing-software-project-risk' },
  thecrunch: { title: 'The Crunch: AI chatbot development cost', url: 'https://thecrunch.io/ai-chatbot-development-cost/' },
  codiant: { title: 'Codiant: AI chatbot development cost', url: 'https://codiant.com/blog/ai-chatbot-development-cost-2026/' },
  pceChatbot: { title: 'Project Cost Estimator: chatbot development cost', url: 'https://projectcostestimator.com/blog/chatbot-development-cost-2026' },
  tensai: { title: 'TensaiForge: GPT, RAG and custom LLM chatbot cost', url: 'https://tensaiforge.com/blog/ai-chatbot-development-cost-guide-2026/' },
  ailog: { title: 'Ailog: RAG pricing', url: 'https://app.ailog.fr/en/blog/guides/rag-pricing-guide-2026' },
  techsyAi: { title: 'Techsy: adding AI features to your app', url: 'https://techsy.io/en/blog/how-to-add-ai-features-to-your-app' },
  appCalc: { title: 'App Development Cost Calculator: methodology (AI-native and agency hours)', url: 'https://appdevelopmentcostcalculator.com/methodology/' },
  shivlab: { title: 'Shiv Technolabs: cost to integrate AI into a mobile app', url: 'https://shivlab.com/blog/cost-to-integrate-ai-into-mobile-app/' },
  wedo: { title: 'WeDoWebApps: AI integration cost, features and timeline', url: 'https://www.wedowebapps.com/ai-integration-cost-mobile-app-features-timeline/' },
  apptitude: { title: 'Apptitude: cost to add AI to your app', url: 'https://apptitude.io/blog/how-much-does-it-cost-to-add-ai-to-your-app/' },
  hireflutter: { title: 'HireFlutterDev: AI mobile app development cost', url: 'https://hireflutterdev.com/blog/ai-mobile-app-development-cost/' },
  rule: { title: 'Rule of thumb: no published figure found, adjust to your own records', url: '' },
} as const;
export type SourceId = keyof typeof ESTIMATE_SOURCES;

export type EstimateGroup = 'Planning and design' | 'Website' | 'Accounts and payments' | 'Web app' | 'E-commerce' | 'Mobile app' | 'AI services' | 'Launch';

export interface CatalogItem {
  id: string;
  group: EstimateGroup;
  name: string;
  detail: string;
  /** What one unit is, when the item is counted (pages, providers, integrations). */
  unit?: string;
  low: number; likely: number; high: number;
  sources: SourceId[];
  /** Built once per mobile platform when apps are native; scaled by the platform factor. */
  mobileClient?: boolean;
}

export const ESTIMATE_CATALOG: CatalogItem[] = [
  // Planning and design
  { id: 'discovery', group: 'Planning and design', name: 'Discovery and requirements', detail: 'Calls, written scope, sitemap or feature list, acceptance criteria.', low: 4, likely: 8, high: 16, sources: ['rule'] },
  { id: 'ui-web', group: 'Planning and design', name: 'UI design, website', detail: 'Wireframes and visual design for the key page templates.', low: 10, likely: 20, high: 40, sources: ['abbacus', 'fireart'] },
  { id: 'ui-app', group: 'Planning and design', name: 'UI/UX design, app', detail: 'Flows, wireframes and visual design for a basic app; complex apps sit at the high end.', low: 40, likely: 80, high: 180, sources: ['topflight', 'kultrix'] },

  // Website
  { id: 'site-base', group: 'Website', name: 'Brochure website, up to 5 pages', detail: 'Responsive, built from the approved design, with navigation and footer.', low: 20, likely: 30, high: 60, sources: ['abbacus', 'pce'] },
  { id: 'site-page', group: 'Website', name: 'Extra page', detail: 'Another page built on an existing template.', unit: 'page', low: 3, likely: 5, high: 8, sources: ['pce', 'rule'] },
  { id: 'landing', group: 'Website', name: 'Custom landing page', detail: 'One bespoke, conversion-focused page.', low: 20, likely: 30, high: 50, sources: ['abbacus', 'itexus'] },
  { id: 'contact-form', group: 'Website', name: 'Contact form with email', detail: 'Form, validation, spam protection, email delivery.', low: 2, likely: 4, high: 6, sources: ['rule'] },
  { id: 'cms', group: 'Website', name: 'Content editing (CMS or blog)', detail: 'Owner can edit pages and publish posts.', low: 8, likely: 12, high: 20, sources: ['itexus'] },
  { id: 'seo', group: 'Website', name: 'SEO basics', detail: 'Titles, meta, sitemap, structured data, redirects.', low: 4, likely: 8, high: 12, sources: ['rule'] },
  { id: 'analytics', group: 'Website', name: 'Analytics and event tracking', detail: 'Analytics setup with the events that matter.', low: 4, likely: 10, high: 40, sources: ['dbbEcom', 'kultrix'] },
  { id: 'i18n-site', group: 'Website', name: 'Second language', detail: 'Translation-ready templates and a language switcher (translation not included).', low: 8, likely: 16, high: 24, sources: ['rule'] },

  // Accounts and payments
  { id: 'auth', group: 'Accounts and payments', name: 'User accounts and login', detail: 'Sign-up, sign-in, password reset, email verification.', low: 20, likely: 30, high: 50, sources: ['itexus', 'upwork', 'deepsel'] },
  { id: 'social-login', group: 'Accounts and payments', name: 'Social login', detail: 'Google, Apple, Facebook and so on.', unit: 'provider', low: 15, likely: 20, high: 25, sources: ['netguru'] },
  { id: 'payments', group: 'Accounts and payments', name: 'Payment gateway, one-time payments', detail: 'Stripe, Razorpay or similar: checkout, webhooks, receipts.', low: 10, likely: 20, high: 40, sources: ['volts', 'itexus'] },
  { id: 'subscriptions', group: 'Accounts and payments', name: 'Subscriptions and recurring billing', detail: 'Plans, trials, upgrades, failed-payment handling.', low: 40, likely: 60, high: 80, sources: ['itexus'] },

  // Web app
  { id: 'admin', group: 'Web app', name: 'Admin panel and dashboard', detail: 'Manage users and records, basic reports. Many roles push it higher.', low: 60, likely: 90, high: 120, sources: ['itexus', 'intellectsoft'] },
  { id: 'api-integration', group: 'Web app', name: 'Third-party API integration', detail: 'One external service (CRM, email, maps, shipping). ERP-scale work is far more.', unit: 'integration', low: 8, likely: 20, high: 60, sources: ['volts', 'abbacusEcom'] },
  { id: 'chat', group: 'Web app', name: 'Real-time chat', detail: 'One-to-one messaging; media, groups and receipts push it up.', low: 60, likely: 120, high: 200, sources: ['netguru', 'deepsel', 'litslink'] },
  { id: 'notifications-email', group: 'Web app', name: 'Email notifications', detail: 'Transactional emails with templates and preferences.', low: 6, likely: 12, high: 20, sources: ['rule'] },

  // E-commerce
  { id: 'store', group: 'E-commerce', name: 'Catalogue, cart and checkout', detail: 'Products, variants, cart, checkout and order emails (payment gateway separate).', low: 120, likely: 160, high: 250, sources: ['dbbEcom', 'abbacusEcom'] },
  { id: 'shipping', group: 'E-commerce', name: 'Shipping carrier integration', detail: 'Live rates, labels and tracking.', low: 80, likely: 120, high: 180, sources: ['dbbEcom'] },
  { id: 'localisation', group: 'E-commerce', name: 'Multi-language and multi-currency store', detail: 'Translated catalogue, prices per currency.', low: 80, likely: 120, high: 200, sources: ['dbbEcom'] },

  // Mobile app
  { id: 'app-base', group: 'Mobile app', name: 'App foundation', detail: 'Project setup, navigation, API client, state, error handling.', low: 20, likely: 30, high: 50, sources: ['rule'], mobileClient: true },
  { id: 'app-screen', group: 'Mobile app', name: 'Standard screen', detail: 'A list, detail or form screen wired to the API.', unit: 'screen', low: 4, likely: 8, high: 14, sources: ['rule'], mobileClient: true },
  { id: 'push', group: 'Mobile app', name: 'Push notifications', detail: 'Permissions, device tokens, sending and deep links.', low: 10, likely: 20, high: 40, sources: ['upwork', 'deepsel', 'nerdify', 'onix'], mobileClient: true },
  { id: 'maps', group: 'Mobile app', name: 'Maps and location', detail: 'Map, markers, current location, search.', low: 8, likely: 30, high: 60, sources: ['netguru', 'deepsel', 'techsy'], mobileClient: true },
  { id: 'tracking', group: 'Mobile app', name: 'Live location tracking', detail: 'Background location and real-time updates.', low: 80, likely: 110, high: 150, sources: ['netguru'], mobileClient: true },
  { id: 'iap', group: 'Mobile app', name: 'In-app purchases', detail: 'Store products, purchase flow, receipt validation.', low: 40, likely: 60, high: 80, sources: ['netguru', 'deepsel'], mobileClient: true },

  // AI services. Hours cover building the feature; model API fees and vector database hosting are running costs, billed separately.
  { id: 'ai-chatbot', group: 'AI services', name: 'AI chatbot (LLM API)', detail: 'Chat widget on GPT, Claude or similar with a system prompt, history and limits. No custom knowledge.', low: 40, likely: 80, high: 150, sources: ['thecrunch', 'techsyAi'] },
  { id: 'ai-rag', group: 'AI services', name: 'AI assistant on your documents (RAG)', detail: 'Ingest documents, embeddings, vector search, cited answers, evaluation. Large or messy data goes far higher (700 to 1,500 h).', low: 200, likely: 400, high: 700, sources: ['codiant', 'pceChatbot', 'tensai', 'ailog'] },
  { id: 'ai-content', group: 'AI services', name: 'AI content generation', detail: 'Generate drafts, descriptions or replies from a form, with prompt templates and review.', low: 24, likely: 40, high: 64, sources: ['appCalc', 'techsyAi'] },
  { id: 'ai-summary', group: 'AI services', name: 'Document summarisation', detail: 'Upload or pick a document, get a summary; long files split and combined.', low: 8, likely: 16, high: 32, sources: ['shivlab', 'wedo'] },
  { id: 'ai-search', group: 'AI services', name: 'Semantic search', detail: 'Search by meaning: embeddings, vector store and a retrieval pipeline.', low: 24, likely: 72, high: 160, sources: ['wedo', 'appCalc', 'apptitude'] },
  { id: 'ai-agent', group: 'AI services', name: 'AI agent with tool calling', detail: 'Takes actions through your APIs, with guardrails and fallbacks. Production-grade with memory: 300 to 500 h.', low: 80, likely: 180, high: 500, sources: ['hireflutter', 'apptitude'] },
  { id: 'ai-voice', group: 'AI services', name: 'Voice commands (speech to text)', detail: 'Recognise speech and trigger actions. A full voice assistant takes 8 to 16 weeks.', low: 25, likely: 32, high: 40, sources: ['shivlab', 'wedo'] },
  { id: 'ai-vision', group: 'AI services', name: 'Image recognition', detail: 'Classify or read images with a vision model; custom-trained computer vision takes 2 to 8 weeks.', low: 24, likely: 60, high: 160, sources: ['shivlab', 'wedo'] },
  { id: 'ai-connector', group: 'AI services', name: 'Connect the AI to a business system', detail: 'CRM, helpdesk, store or an internal tool the assistant reads from or acts on.', unit: 'integration', low: 20, likely: 40, high: 60, sources: ['codiant', 'thecrunch'] },

  // Launch
  { id: 'deploy-web', group: 'Launch', name: 'Hosting, domain and deployment', detail: 'Production setup, SSL, backups, a deploy pipeline.', low: 4, likely: 8, high: 16, sources: ['rule'] },
  { id: 'store-release', group: 'Launch', name: 'App store submission', detail: 'Store listings, screenshots, privacy forms, review fixes.', low: 8, likely: 16, high: 24, sources: ['kultrix', 'rule'] },
];

export interface EstimateTemplate { id: string; name: string; description: string; items: { id: string; qty?: number }[]; mobile?: MobilePlatform }
export const ESTIMATE_TEMPLATES: EstimateTemplate[] = [
  { id: 'brochure', name: 'Business website', description: '5 pages, contact form, SEO and analytics.', items: [{ id: 'discovery' }, { id: 'ui-web' }, { id: 'site-base' }, { id: 'contact-form' }, { id: 'seo' }, { id: 'analytics' }, { id: 'deploy-web' }] },
  { id: 'landing', name: 'Landing page', description: 'One custom page with a form.', items: [{ id: 'discovery' }, { id: 'landing' }, { id: 'contact-form' }, { id: 'analytics' }, { id: 'deploy-web' }] },
  { id: 'store', name: 'Online store', description: 'Catalogue, cart, checkout and payments.', items: [{ id: 'discovery' }, { id: 'ui-web' }, { id: 'site-base' }, { id: 'store' }, { id: 'payments' }, { id: 'auth' }, { id: 'cms' }, { id: 'seo' }, { id: 'analytics' }, { id: 'deploy-web' }] },
  { id: 'webapp', name: 'Web app (SaaS)', description: 'Accounts, subscriptions and an admin panel.', items: [{ id: 'discovery' }, { id: 'ui-web' }, { id: 'auth' }, { id: 'subscriptions' }, { id: 'admin' }, { id: 'notifications-email' }, { id: 'api-integration', qty: 1 }, { id: 'deploy-web' }] },
  { id: 'ai-assistant', name: 'AI assistant', description: 'Chatbot answering from your documents, on a website.', items: [{ id: 'discovery' }, { id: 'ui-web' }, { id: 'ai-rag' }, { id: 'ai-connector', qty: 1 }, { id: 'auth' }, { id: 'analytics' }, { id: 'deploy-web' }] },
  { id: 'app', name: 'Mobile app', description: 'Cross-platform app with login, 8 screens and push.', items: [{ id: 'discovery' }, { id: 'ui-app' }, { id: 'app-base' }, { id: 'app-screen', qty: 8 }, { id: 'auth' }, { id: 'push' }, { id: 'admin' }, { id: 'deploy-web' }, { id: 'store-release' }], mobile: 'cross' },
];

/** Cross-platform frameworks save roughly 30 to 50% against two native apps; 1.65 is the midpoint (two natives ≈ cross ÷ 0.6). */
export const MOBILE_FACTORS = { cross: 1, 'one-native': 1, 'two-native': 1.65 } as const;
export type MobilePlatform = keyof typeof MOBILE_FACTORS;
export const MOBILE_FACTOR_SOURCES: SourceId[] = ['glance', 'chopdawg'];

export type HourBasis = 'low' | 'expected' | 'high';
/** Defaults for the share of build time spent on testing, management and the unknown (basis points). */
export const ESTIMATE_DEFAULTS = { qaBps: 2000, pmBps: 1000, contingencyBps: 1500 } as const;
export const OVERHEAD_SOURCES = { qa: ['rule'] as SourceId[], pm: ['rule'] as SourceId[], contingency: ['contingency', 'qsm'] as SourceId[] };

export interface EstimateLineInput {
  /** A catalogue id, or omitted for your own line. */
  itemId?: string;
  name?: string;
  qty: number;
  /** Your own hours per unit; replaces the researched figure. */
  hoursEach?: number;
}
export type EstimateDiscount =
  | { kind: 'none' }
  | { kind: 'percent'; bps: number }
  | { kind: 'amount'; amount: string }
  | { kind: 'rate'; rate: string };

export interface EstimateInput {
  currency: string;
  /** Your hourly rate, a decimal string such as "45" or "45.50". */
  rate: string;
  basis: HourBasis;
  mobile: MobilePlatform;
  lines: EstimateLineInput[];
  qaBps: number; pmBps: number; contingencyBps: number;
  discount: EstimateDiscount;
  taxBps: number;
}

export interface EstimateLine { itemId?: string; group?: EstimateGroup; name: string; qty: number; unit?: string; hoursEach: number; hours: number; researched: boolean; low?: number; high?: number }
export interface EstimateResult {
  lines: EstimateLine[];
  buildHours: number; qaHours: number; pmHours: number; contingencyHours: number; totalHours: number;
  rate: Money; billedRate: Money;
  gross: Money; discount: Money; net: Money; tax: Money; total: Money;
  /** What you actually earn per hour after any discount (before tax). */
  effectiveRate: Money;
  range: { lowHours: number; highHours: number; low: Money; high: Money };
}

const halfHours = (h: number) => Math.round(h * 2);
const hoursOf = (half: number) => half / 2;
const pert = (i: CatalogItem) => (i.low + 4 * i.likely + i.high) / 6;
const pick = (i: CatalogItem, b: HourBasis) => (b === 'low' ? i.low : b === 'high' ? i.high : pert(i));
const byId = new Map(ESTIMATE_CATALOG.map((i) => [i.id, i]));
export const catalogItem = (id: string) => byId.get(id);

/** Hours for one set of lines at one basis, in half hours: lines, then overheads on the build, contingency on both. */
function hoursFor(input: EstimateInput, basis: HourBasis) {
  const factor = MOBILE_FACTORS[input.mobile];
  const lines: EstimateLine[] = input.lines.filter((l) => l.qty > 0).map((l) => {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new Error(`Unknown estimate item: ${l.itemId}`);
    const researched = l.hoursEach === undefined && !!item;
    const each = (l.hoursEach ?? (item ? pick(item, basis) : 0)) * (item?.mobileClient ? factor : 1);
    return { itemId: item?.id, group: item?.group, name: l.name?.trim() || item?.name || 'Custom work', qty: l.qty, unit: item?.unit, hoursEach: hoursOf(halfHours(each)), hours: hoursOf(halfHours(each) * Math.round(l.qty)), researched, low: item?.low, high: item?.high };
  });
  const build = lines.reduce((s, l) => s + halfHours(l.hours), 0);
  const qa = Math.round((build * input.qaBps) / 10_000);
  const pm = Math.round((build * input.pmBps) / 10_000);
  const contingency = Math.round(((build + qa + pm) * input.contingencyBps) / 10_000);
  return { lines, build, qa, pm, contingency, total: build + qa + pm + contingency };
}

/** Money for a number of half hours at a rate (minor units), rounded half away from zero. */
const priceHalfHours = (half: number, rate: Money) => money(divRound(BigInt(half) * rate.amountMinor, 2n), rate.currency);

function priced(input: EstimateInput, totalHalf: number) {
  const rate = parseMoney(input.rate, input.currency);
  const gross = priceHalfHours(totalHalf, rate);
  let discountMinor = 0n;
  let billedRate = rate;
  const d = input.discount;
  if (d.kind === 'percent') discountMinor = divRound(gross.amountMinor * BigInt(Math.max(0, Math.min(10_000, d.bps))), 10_000n);
  else if (d.kind === 'amount') discountMinor = parseMoney(d.amount, input.currency).amountMinor;
  else if (d.kind === 'rate') {
    billedRate = parseMoney(d.rate, input.currency);
    discountMinor = gross.amountMinor - priceHalfHours(totalHalf, billedRate).amountMinor;
  }
  if (discountMinor < 0n) discountMinor = 0n; // a "discounted" rate above your rate is not a discount
  if (discountMinor > gross.amountMinor) discountMinor = gross.amountMinor;
  const net = gross.amountMinor - discountMinor;
  const tax = divRound(net * BigInt(input.taxBps), 10_000n);
  return { rate, billedRate: d.kind === 'rate' && discountMinor > 0n ? billedRate : rate, gross, discount: money(discountMinor, input.currency), net: money(net, input.currency), tax: money(tax, input.currency), total: money(net + tax, input.currency) };
}

export function calculateEstimate(input: EstimateInput): EstimateResult {
  if (!/^\d+(\.\d+)?$/.test(input.rate) || Number(input.rate) <= 0) throw new Error('Rate must be a positive number');
  const h = hoursFor(input, input.basis);
  const p = priced(input, h.total);
  const lo = hoursFor(input, 'low'); const hi = hoursFor(input, 'high');
  const effectiveRate = h.total === 0 ? money(0n, input.currency) : money(divRound(p.net.amountMinor * 2n, BigInt(h.total)), input.currency);
  return {
    lines: h.lines, buildHours: hoursOf(h.build), qaHours: hoursOf(h.qa), pmHours: hoursOf(h.pm), contingencyHours: hoursOf(h.contingency), totalHours: hoursOf(h.total),
    ...p, effectiveRate,
    range: { lowHours: hoursOf(lo.total), highHours: hoursOf(hi.total), low: priced(input, lo.total).net, high: priced(input, hi.total).net },
  };
}

/** The estimate as proposal line items: one per feature plus testing, management and contingency, each priced in hours. */
export function estimateToProposalLines(input: EstimateInput, r: EstimateResult) {
  const rate = toDecimalString(r.billedRate);
  // A percentage or fixed amount off the whole becomes the same percentage on every line (fixed amounts to 0.01%).
  const discountBps = input.discount.kind === 'percent' ? input.discount.bps
    : input.discount.kind === 'amount' && r.gross.amountMinor > 0n ? Number(divRound(r.discount.amountMinor * 10_000n, r.gross.amountMinor)) : 0;
  const line = (description: string, hours: number) => ({ description, quantity: String(hours), unitLabel: 'hours', unitRate: rate, discountBps, taxBps: input.taxBps });
  return [
    ...r.lines.filter((l) => l.hours > 0).map((l) => line(l.qty > 1 || l.unit ? `${l.name} (${l.qty} ${l.unit ?? 'unit'}${l.qty === 1 ? '' : 's'})` : l.name, l.hours)),
    ...(r.qaHours > 0 ? [line('Testing and fixes', r.qaHours)] : []),
    ...(r.pmHours > 0 ? [line('Project management and communication', r.pmHours)] : []),
    ...(r.contingencyHours > 0 ? [line('Contingency for unknowns', r.contingencyHours)] : []),
  ];
}

// ───────── payment plans ─────────

/**
 * How the client pays, saved into the proposal as its pricing model and payment terms.
 * - deposit: a deposit to start, the rest on completion (fixed price).
 * - milestone: a deposit, then one payment per phase, each sized by that phase's share of the hours.
 * - monthly: the fixed price in equal monthly payments, the first on acceptance.
 * - hourly: invoiced for the hours actually worked each week, fortnight or month; the estimate is a forecast.
 */
export type PaymentPlan =
  | { kind: 'deposit'; depositBps: number }
  | { kind: 'milestone'; depositBps: number; dueInDays: number }
  | { kind: 'monthly'; months: number }
  | { kind: 'hourly'; cycle: 'weekly' | 'fortnightly' | 'monthly'; dueInDays: number };

export interface PlanTerm { label: string; kind: 'UPFRONT' | 'MILESTONE' | 'ON_COMPLETION' | 'NET_DAYS'; percentageBps?: number; dueInDays?: number }
export interface PlannedPayments {
  pricingModel: 'FIXED' | 'MILESTONE' | 'HOURLY';
  terms: PlanTerm[];
  /** What each term comes to, for a preview (null for hourly, where the amount depends on hours worked). */
  amounts: (Money | null)[];
  /** One sentence for the proposal. */
  description: string;
}

/** Splits 10,000 basis points by weight; the largest remainders get the leftover points, so the parts always total exactly. */
function splitBps(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  for (const i of raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (left-- <= 0) break; out[i]! += 1; }
  return out;
}

const PHASE_LABEL = (g: EstimateGroup | 'Other') => g === 'Planning and design' ? 'Planning and design approved' : g === 'Launch' ? 'Launch' : g === 'Other' ? 'Additional work delivered' : `${g} delivered`;
const GROUP_ORDER: (EstimateGroup | 'Other')[] = ['Planning and design', 'Website', 'Accounts and payments', 'Web app', 'E-commerce', 'Mobile app', 'AI services', 'Other', 'Launch'];

/** Phases of the work in delivery order with their build hours; phases under 10% of the build join the next one. */
export function estimatePhases(r: EstimateResult): { label: string; hours: number }[] {
  const by = new Map<EstimateGroup | 'Other', number>();
  for (const l of r.lines) by.set(l.group ?? 'Other', (by.get(l.group ?? 'Other') ?? 0) + l.hours);
  const phases = GROUP_ORDER.filter((g) => (by.get(g) ?? 0) > 0).map((g) => ({ label: PHASE_LABEL(g), hours: by.get(g)! }));
  const total = phases.reduce((a, p) => a + p.hours, 0);
  const merged: { label: string; hours: number }[] = [];
  let carry = 0;
  for (const [i, p] of phases.entries()) {
    const last = i === phases.length - 1;
    if (!last && (p.hours + carry) / total < 0.1) { carry += p.hours; continue; }
    merged.push({ label: p.label, hours: p.hours + carry }); carry = 0;
  }
  // A small final phase (often Launch) folds back into the one before it.
  if (merged.length > 1 && merged.at(-1)!.hours / total < 0.1) { const tail = merged.pop()!; merged.at(-1)!.hours += tail.hours; merged.at(-1)!.label = `${merged.at(-1)!.label} and ${tail.label.toLowerCase()}`; }
  return merged;
}

const ofTotal = (r: EstimateResult, bps: number) => money(divRound(r.total.amountMinor * BigInt(bps), 10_000n), r.total.currency);
const pctText = (bps: number) => `${bps % 100 === 0 ? bps / 100 : (bps / 100).toFixed(2)}%`;

export function planPayments(plan: PaymentPlan, r: EstimateResult): PlannedPayments {
  const withAmounts = (terms: PlanTerm[]) => {
    // Amounts in the preview add up exactly to the total: the last percentage term takes the rounding.
    const amounts = terms.map((t) => (t.percentageBps === undefined ? null : ofTotal(r, t.percentageBps)));
    const pct = amounts.filter((a): a is Money => a !== null);
    if (pct.length) { const diff = r.total.amountMinor - pct.reduce((s, a) => s + a.amountMinor, 0n); const i = amounts.map((a) => a !== null).lastIndexOf(true); amounts[i] = money(amounts[i]!.amountMinor + diff, r.total.currency); }
    return amounts;
  };
  if (plan.kind === 'deposit') {
    const d = Math.max(0, Math.min(10_000, Math.round(plan.depositBps)));
    const terms: PlanTerm[] = [...(d > 0 ? [{ label: 'Deposit to start', kind: 'UPFRONT' as const, percentageBps: d }] : []), ...(d < 10_000 ? [{ label: 'On completion', kind: 'ON_COMPLETION' as const, percentageBps: 10_000 - d }] : [])];
    return { pricingModel: 'FIXED', terms, amounts: withAmounts(terms), description: d > 0 && d < 10_000 ? `Fixed price: ${pctText(d)} to start, ${pctText(10_000 - d)} on completion.` : d === 0 ? 'Fixed price, paid on completion.' : 'Fixed price, paid in full to start.' };
  }
  if (plan.kind === 'milestone') {
    const d = Math.max(0, Math.min(9_000, Math.round(plan.depositBps)));
    const phases = estimatePhases(r);
    const shares = splitBps(10_000 - d, phases.map((p) => p.hours));
    const terms: PlanTerm[] = [
      ...(d > 0 ? [{ label: 'Deposit to start', kind: 'UPFRONT' as const, percentageBps: d }] : []),
      ...phases.map((p, i) => ({ label: p.label, kind: (i === phases.length - 1 ? 'ON_COMPLETION' : 'MILESTONE') as PlanTerm['kind'], percentageBps: shares[i]!, ...(plan.dueInDays > 0 ? { dueInDays: plan.dueInDays } : {}) })),
    ];
    return { pricingModel: 'MILESTONE', terms, amounts: withAmounts(terms), description: `Paid by milestone: ${d > 0 ? `${pctText(d)} to start, then ` : ''}${phases.length} ${phases.length === 1 ? 'payment' : 'payments'} as each phase is delivered, sized by its share of the work.` };
  }
  if (plan.kind === 'monthly') {
    const n = Math.max(2, Math.min(12, Math.round(plan.months)));
    const shares = splitBps(10_000, Array.from({ length: n }, () => 1));
    const terms: PlanTerm[] = shares.map((bps, i) => (i === 0 ? { label: `Payment 1 of ${n}, on acceptance`, kind: 'UPFRONT', percentageBps: bps } : { label: `Payment ${i + 1} of ${n}, ${i} ${i === 1 ? 'month' : 'months'} after start`, kind: 'NET_DAYS', percentageBps: bps, dueInDays: i * 30 }));
    return { pricingModel: 'FIXED', terms, amounts: withAmounts(terms), description: `Fixed price in ${n} equal monthly payments, the first on acceptance.` };
  }
  const every = { weekly: 'every week', fortnightly: 'every two weeks', monthly: 'every month' }[plan.cycle];
  const terms: PlanTerm[] = [{ label: `Invoiced ${every} for hours worked`, kind: 'NET_DAYS', dueInDays: Math.max(0, Math.min(365, Math.round(plan.dueInDays))) }];
  return { pricingModel: 'HOURLY', terms, amounts: [null], description: `Billed by the hour at ${toDecimalString(r.billedRate)} ${r.billedRate.currency}, invoiced ${every} for hours actually worked, due within ${terms[0]!.dueInDays} days. The ${r.totalHours} hours above are an estimate (range ${r.range.lowHours} to ${r.range.highHours} hours), not a cap.` };
}
