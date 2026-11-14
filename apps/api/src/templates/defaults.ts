/**
 * Starter templates seeded per workspace. They are starting points to edit, not finished documents:
 * bracketed text is guidance for the author. Agreement clauses are generic and are NOT legal advice —
 * have them reviewed before relying on them (PRD §7.6: never claim a template guarantees enforceability).
 */
export interface TemplateSection { kind: string; title: string; body: string }
export interface TemplatePaymentTerm { label: string; kind: 'UPFRONT' | 'MILESTONE' | 'ON_COMPLETION' | 'NET_DAYS'; percentageBps?: number; dueInDays?: number }
export interface DefaultTemplate {
  kind: 'PROPOSAL' | 'AGREEMENT';
  name: string;
  description: string;
  body: Record<string, unknown>;
}

const proposalSections = (extra: TemplateSection[] = []): TemplateSection[] => [
  { kind: 'INTRODUCTION', title: 'Introduction', body: 'Thank you for the opportunity to work with {{client.name}}. [Summarise the problem you heard and the outcome the client wants.]' },
  { kind: 'SCOPE', title: 'Scope of work', body: '[Describe what is included. Be specific enough that both sides could tell whether something is in or out of scope.]' },
  { kind: 'DELIVERABLES', title: 'Deliverables', body: '[List each deliverable and how it will be handed over.]' },
  { kind: 'TIMELINE', title: 'Timeline', body: '[Key milestones and target dates. State what you need from the client to stay on schedule.]' },
  ...extra,
  { kind: 'ASSUMPTIONS', title: 'Assumptions', body: '[Things you are relying on, e.g. timely feedback, access to systems, a single point of contact.]' },
  { kind: 'EXCLUSIONS', title: 'Exclusions', body: '[Anything that is explicitly not included.]' },
  { kind: 'TERMS', title: 'Commercial terms', body: 'Fees are exclusive of applicable taxes unless stated. Work outside this scope is handled through a change request and priced separately. This proposal is valid until the date shown above.' },
];

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    kind: 'PROPOSAL',
    name: 'Fixed-price project',
    description: 'A fixed fee split between kickoff and completion.',
    body: {
      pricingModel: 'FIXED',
      sections: proposalSections(),
      paymentTerms: [
        { label: 'On acceptance', kind: 'UPFRONT', percentageBps: 5000 },
        { label: 'On completion', kind: 'ON_COMPLETION', percentageBps: 5000 },
      ],
    },
  },
  {
    kind: 'PROPOSAL',
    name: 'Milestone-based project',
    description: 'Fees released as each milestone is delivered.',
    body: {
      pricingModel: 'MILESTONE',
      sections: proposalSections([{ kind: 'CUSTOM', title: 'Milestones and payments', body: '[List each milestone, what is delivered, and the amount payable on delivery.]' }]),
      paymentTerms: [
        { label: 'Kickoff', kind: 'UPFRONT', percentageBps: 2000 },
        { label: 'Milestone payments', kind: 'MILESTONE', percentageBps: 6000 },
        { label: 'Final delivery', kind: 'ON_COMPLETION', percentageBps: 2000 },
      ],
    },
  },
  {
    kind: 'PROPOSAL',
    name: 'Hourly / time and materials',
    description: 'Billed on hours worked, invoiced monthly.',
    body: {
      pricingModel: 'HOURLY',
      sections: proposalSections(),
      paymentTerms: [{ label: 'Invoiced monthly in arrears', kind: 'NET_DAYS', dueInDays: 30 }],
    },
  },
  {
    kind: 'AGREEMENT',
    name: 'Services agreement (general starting point)',
    description: 'Generic independent-contractor clauses. A starting point only: have it reviewed before use; it is not legal advice.',
    body: {
      clauses: [
        { heading: 'Parties', body: 'This agreement is between {{freelancer.name}} ("Contractor") and {{client.name}} ("Client"), effective {{effective.date}}.' },
        { heading: 'Services', body: 'The Contractor will provide the services described in {{proposal.number}} (the "Services"). Changes to the Services are agreed in writing before the changed work begins.' },
        { heading: 'Fees and payment', body: 'The Client will pay the fees stated in {{proposal.number}} (total {{proposal.total}}), on the payment terms stated there. Late amounts [LATE-PAYMENT TERMS].' },
        { heading: 'Client responsibilities', body: 'The Client will provide timely feedback, access and information reasonably needed to perform the Services. Delays caused by the Client may move agreed dates.' },
        { heading: 'Intellectual property', body: '[Describe who owns the deliverables and when ownership transfers, e.g. on full payment. Describe any pre-existing materials the Contractor keeps.]' },
        { heading: 'Confidentiality', body: 'Each party will keep the other\'s non-public information confidential and use it only for the purposes of this agreement. [Add duration and exceptions.]' },
        { heading: 'Liability', body: '[Describe any limitation of liability and warranties.]' },
        { heading: 'Term and termination', body: 'This agreement continues until the Services are completed unless ended earlier by either party with [NOTICE PERIOD] written notice. Fees for work completed up to termination remain payable.' },
        { heading: 'Governing law', body: 'This agreement is governed by the laws of [GOVERNING LAW / JURISDICTION].' },
      ],
    },
  },
];
