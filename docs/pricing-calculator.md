# Price calculator: method and sources

In the app: **Proposals > Price calculator** (`/estimator`). Code: `packages/shared/src/estimate.ts` (tested in `estimate.test.ts`).

## Formula

1. Hours per item: *Lean* = low, *Safe* = high, *Expected* = (low + 4 × likely + high) ÷ 6 (three-point estimate). Your own hours replace any figure.
2. Two native mobile apps multiply app-side items by 1.65 (cross-platform saves about 30 to 50%).
3. Testing (default 20%) and management (10%) are shares of the build; contingency (15%; 10 to 20% is typical) is a share of everything.
4. Price = total hours × your rate (default $45), then the discount (% off the total, an amount off, or a lower hourly rate), then tax.
5. Payment terms: deposit and completion (fixed price), by milestone (a deposit, then one payment per phase sized by its hours), monthly payments (2 to 12, equal), or hourly billed as worked (weekly, fortnightly or monthly). The plan sets the proposal's pricing model and payment terms.

Hours are kept to the half hour and money is exact; a proposal created from an estimate totals exactly the same.

## Hours per item

| Group | Item | Low | Likely | High | Sources |
|---|---|---:|---:|---:|---|
| Planning and design | Discovery and requirements | 4 | 8 | 16 | rule of thumb |
| Planning and design | UI design, website | 10 | 20 | 40 | [Abbacus Technologies](https://www.abbacustechnologies.com/how-many-hours-to-build-a-website/), [Fireart](https://fireart.studio/blog/how-to-calculate-web-design-and-website-development-cost/) |
| Planning and design | UI/UX design, app | 40 | 80 | 180 | [Topflight](https://topflightapps.com/ideas/how-long-does-it-take-to-develop-an-app/), [Kultrix](https://kultrix.com/blog/app-development-cost-timeline) |
| Website | Brochure website, up to 5 pages | 20 | 30 | 60 | [Abbacus Technologies](https://www.abbacustechnologies.com/how-many-hours-to-build-a-website/), [Project Cost Estimator](https://projectcostestimator.com/freelance-website-cost) |
| Website | Extra page (per page) | 3 | 5 | 8 | [Project Cost Estimator](https://projectcostestimator.com/freelance-website-cost), rule of thumb |
| Website | Custom landing page | 20 | 30 | 50 | [Abbacus Technologies](https://www.abbacustechnologies.com/how-many-hours-to-build-a-website/), [Itexus](https://itexus.com/website-development-cost-breakdown/) |
| Website | Contact form with email | 2 | 4 | 6 | rule of thumb |
| Website | Content editing (CMS or blog) | 8 | 12 | 20 | [Itexus](https://itexus.com/website-development-cost-breakdown/) |
| Website | SEO basics | 4 | 8 | 12 | rule of thumb |
| Website | Analytics and event tracking | 4 | 10 | 40 | [DBB Software](https://dbbsoftware.com/insights/ecommerce-website-development-cost), [Kultrix](https://kultrix.com/blog/app-development-cost-timeline) |
| Website | Second language | 8 | 16 | 24 | rule of thumb |
| Accounts and payments | User accounts and login | 20 | 30 | 50 | [Itexus](https://itexus.com/website-development-cost-breakdown/), [Upwork](https://www.upwork.com/resources/cost-build-mobile-app), [Deepsel](https://deepsel.com/app-development-cost/) |
| Accounts and payments | Social login (per provider) | 15 | 20 | 25 | [Netguru](https://www.netguru.com/blog/mobile-app-development-cost) |
| Accounts and payments | Payment gateway, one-time payments | 10 | 20 | 40 | [Volts Consulting](https://voltsconsulting.com/web-app-development-cost/), [Itexus](https://itexus.com/website-development-cost-breakdown/) |
| Accounts and payments | Subscriptions and recurring billing | 40 | 60 | 80 | [Itexus](https://itexus.com/website-development-cost-breakdown/) |
| Web app | Admin panel and dashboard | 60 | 90 | 120 | [Itexus](https://itexus.com/website-development-cost-breakdown/), [Intellectsoft](https://www.intellectsoft.net/blog/website-development-cost/) |
| Web app | Third-party API integration (per integration) | 8 | 20 | 60 | [Volts Consulting](https://voltsconsulting.com/web-app-development-cost/), [Abbacus Technologies](https://www.abbacustechnologies.com/how-much-does-it-cost-to-develop-an-ecommerce-store/) |
| Web app | Real-time chat | 60 | 120 | 200 | [Netguru](https://www.netguru.com/blog/mobile-app-development-cost), [Deepsel](https://deepsel.com/app-development-cost/), [Litslink](https://litslink.com/blog/mobile-app-development-cost) |
| Web app | Email notifications | 6 | 12 | 20 | rule of thumb |
| E-commerce | Catalogue, cart and checkout | 120 | 160 | 250 | [DBB Software](https://dbbsoftware.com/insights/ecommerce-website-development-cost), [Abbacus Technologies](https://www.abbacustechnologies.com/how-much-does-it-cost-to-develop-an-ecommerce-store/) |
| E-commerce | Shipping carrier integration | 80 | 120 | 180 | [DBB Software](https://dbbsoftware.com/insights/ecommerce-website-development-cost) |
| E-commerce | Multi-language and multi-currency store | 80 | 120 | 200 | [DBB Software](https://dbbsoftware.com/insights/ecommerce-website-development-cost) |
| Mobile app | App foundation | 20 | 30 | 50 | rule of thumb |
| Mobile app | Standard screen (per screen) | 4 | 8 | 14 | rule of thumb |
| Mobile app | Push notifications | 10 | 20 | 40 | [Upwork](https://www.upwork.com/resources/cost-build-mobile-app), [Deepsel](https://deepsel.com/app-development-cost/), [Nerdify](https://getnerdify.com/blog/mobile-app-development-cost-calculator/), [Onix](https://onix-systems.com/blog/how-much-does-mobile-app-development-cost) |
| Mobile app | Maps and location | 8 | 30 | 60 | [Netguru](https://www.netguru.com/blog/mobile-app-development-cost), [Deepsel](https://deepsel.com/app-development-cost/), [Techsy](https://techsy.io/en/blog/mobile-app-cost) |
| Mobile app | Live location tracking | 80 | 110 | 150 | [Netguru](https://www.netguru.com/blog/mobile-app-development-cost) |
| Mobile app | In-app purchases | 40 | 60 | 80 | [Netguru](https://www.netguru.com/blog/mobile-app-development-cost), [Deepsel](https://deepsel.com/app-development-cost/) |
| AI services | AI chatbot (LLM API) | 40 | 80 | 150 | [The Crunch](https://thecrunch.io/ai-chatbot-development-cost/), [Techsy](https://techsy.io/en/blog/how-to-add-ai-features-to-your-app) |
| AI services | AI assistant on your documents (RAG) | 200 | 400 | 700 | [Codiant](https://codiant.com/blog/ai-chatbot-development-cost-2026/), [Project Cost Estimator](https://projectcostestimator.com/blog/chatbot-development-cost-2026), [TensaiForge](https://tensaiforge.com/blog/ai-chatbot-development-cost-guide-2026/), [Ailog](https://app.ailog.fr/en/blog/guides/rag-pricing-guide-2026) |
| AI services | AI content generation | 24 | 40 | 64 | [App Development Cost Calculator](https://appdevelopmentcostcalculator.com/methodology/), [Techsy](https://techsy.io/en/blog/how-to-add-ai-features-to-your-app) |
| AI services | Document summarisation | 8 | 16 | 32 | [Shiv Technolabs](https://shivlab.com/blog/cost-to-integrate-ai-into-mobile-app/), [WeDoWebApps](https://www.wedowebapps.com/ai-integration-cost-mobile-app-features-timeline/) |
| AI services | Semantic search | 24 | 72 | 160 | [WeDoWebApps](https://www.wedowebapps.com/ai-integration-cost-mobile-app-features-timeline/), [App Development Cost Calculator](https://appdevelopmentcostcalculator.com/methodology/), [Apptitude](https://apptitude.io/blog/how-much-does-it-cost-to-add-ai-to-your-app/) |
| AI services | AI agent with tool calling | 80 | 180 | 500 | [HireFlutterDev](https://hireflutterdev.com/blog/ai-mobile-app-development-cost/), [Apptitude](https://apptitude.io/blog/how-much-does-it-cost-to-add-ai-to-your-app/) |
| AI services | Voice commands (speech to text) | 25 | 32 | 40 | [Shiv Technolabs](https://shivlab.com/blog/cost-to-integrate-ai-into-mobile-app/), [WeDoWebApps](https://www.wedowebapps.com/ai-integration-cost-mobile-app-features-timeline/) |
| AI services | Image recognition | 24 | 60 | 160 | [Shiv Technolabs](https://shivlab.com/blog/cost-to-integrate-ai-into-mobile-app/), [WeDoWebApps](https://www.wedowebapps.com/ai-integration-cost-mobile-app-features-timeline/) |
| AI services | Connect the AI to a business system (per integration) | 20 | 40 | 60 | [Codiant](https://codiant.com/blog/ai-chatbot-development-cost-2026/), [The Crunch](https://thecrunch.io/ai-chatbot-development-cost/) |
| Launch | Hosting, domain and deployment | 4 | 8 | 16 | rule of thumb |
| Launch | App store submission | 8 | 16 | 24 | [Kultrix](https://kultrix.com/blog/app-development-cost-timeline), rule of thumb |

These are published estimates, mostly from agency and platform guides rather than tracked projects. "Rule of thumb" marks items with no published figure. AI items cover building the feature; model API fees and vector database hosting are running costs billed separately.
