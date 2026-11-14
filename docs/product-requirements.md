# FreelanceOS --- Product Requirements Document

**Document type:** Product Requirements Document (PRD)\
**Version:** 1.0\
**Status:** Draft for product and engineering review\
**Product:** FreelanceOS\
**Primary market/context:** Independent software freelancers and small
independent service businesses\
**Primary currency:** INR, with multi-currency support\
**Initial operating model:** Single freelancer/owner workspace,
architected to support future multi-tenant SaaS

------------------------------------------------------------------------

## 1. Executive Summary

FreelanceOS is an all-in-one freelance business management platform for
independent software freelancers. It manages the complete commercial and
delivery lifecycle between a freelancer and their clients:

**Lead → Client → Engagement → Proposal → Agreement → Approved Scope →
Project Delivery → Change Requests → Invoice & Payment → Closure**

The product is more than a task manager or CRM. It is a commercial
engagement and delivery management system that connects what was
promised, what was approved, what is being delivered, and what is being
paid for.

FreelanceOS provides: - A private freelancer workspace for managing
clients, sales, proposals, agreements, projects, scope, finance,
documents and business activity. - A dedicated client portal where
clients can review and approve shared proposals, agreements, scope,
change requests, project updates, documents and invoices. - A traceable
history of commercial decisions and delivery changes. - Reusable
templates and consistent document generation. - A data model that
preserves financial and contractual history and can later support
multiple workspaces and a commercial SaaS offering.

The first release is designed for one freelancer/owner. The architecture
must not make a future multi-tenant product difficult, but subscription
management, SaaS billing and complex team collaboration are not part of
the initial scope.

## 2. Product Vision

Give independent freelancers one reliable operating system for running
their business---from the first client conversation to final
payment---without losing track of commitments, approvals, delivery or
money.

### 2.1 Product principles

1.  **One source of truth:** Client, engagement, proposal, agreement,
    scope, project and finance records should be connected rather than
    repeatedly re-entered.
2.  **Commercial traceability:** Important decisions must identify who
    approved what, when, and against which version.
3.  **Client transparency with boundaries:** Clients see only
    information deliberately shared with them.
4.  **Immutable commitments:** Accepted proposal versions, signed
    agreements, approved scope versions and issued invoices must not be
    silently overwritten.
5.  **Financial integrity:** Preserve original transaction currency,
    historical exchange rates and auditable payment allocations.
6.  **Progressive complexity:** Common workflows should be
    straightforward; advanced commercial arrangements should be
    supported without overwhelming the default experience.
7.  **Explicit lifecycle transitions:** A lead does not automatically
    become a client engagement; a proposal does not automatically become
    a signed agreement; approval of a change does not automatically
    amend a signed contract.
8.  **Future-ready tenancy:** Workspace ownership and data boundaries
    should exist from the beginning, even though the first deployment
    may have only one workspace.

## 3. Goals and Success Measures

### 3.1 Product goals

-   Maintain a complete, connected record of every client relationship.
-   Create and manage proposals with multiple pricing models and
    immutable versions.
-   Manage agreements, signers, signatures and amendments.
-   Define, approve, freeze and version project scope.
-   Deliver work through milestones, tasks and deliverables.
-   Process change requests with explicit impact assessment and
    approval.
-   Track invoices, partial payments, payment allocations, expenses and
    retainers.
-   Give clients a secure portal for the information and actions
    relevant to them.
-   Reduce manual document creation, status chasing and duplicate data
    entry.
-   Provide a clear view of business health, outstanding actions and
    upcoming deadlines.

### 3.2 Suggested success metrics

These are proposed product metrics; targets should be set after baseline
usage is available.

  -----------------------------------------------------------------------
  Area                                Metric
  ----------------------------------- -----------------------------------
  Client management                   Percentage of active client
                                      relationships with complete contact
                                      records

  Sales                               Time required to create and send a
                                      proposal

  Commercial control                  Percentage of accepted proposals
                                      linked to an exact immutable
                                      version

  Contracting                         Percentage of agreements with
                                      recorded signer and signature
                                      status

  Scope control                       Percentage of active projects with
                                      an approved scope version

  Change management                   Percentage of change requests with
                                      recorded impact and decision

  Delivery                            Percentage of milestones with an
                                      owner, due date and status

  Finance                             Outstanding invoice amount and
                                      invoice ageing

  Payments                            Percentage of payments allocated to
                                      one or more invoices

  Client experience                   Client portal activation and
                                      approval completion rates

  Reliability                         Failed background jobs, email
                                      delivery failures and document
                                      generation failures
  -----------------------------------------------------------------------

## 4. Users, Roles and Access Model

### 4.1 Initial users

**Freelancer / Workspace Owner** - The primary internal user. - Has
access to all workspace data and configuration. - Creates clients,
engagements, proposals, agreements, projects, invoices and documents. -
Controls which information is shared with clients.

**Client Organization** - An external business or individual receiving
freelance services. - A client organization is not a member of the
freelancer's workspace. - May have multiple contacts and multiple portal
users.

**Client Contact / Portal User** - A person associated with a client
organization. - Can access only the records, projects, documents and
actions explicitly authorized for that organization/contact. - May be
invited through an account/password flow or access through a
passwordless magic link, subject to configured security controls.

### 4.2 Access principles

-   Do not treat possession of a record URL or ID as authorization.
-   Every client portal request must validate organization, contact,
    project and action permissions.
-   Internal-only content must never be returned to client-facing APIs.
-   Visibility must be explicit, such as:
    -   `INTERNAL`
    -   `CLIENT_VISIBLE`
    -   `SHARED_WITH_SELECTED_CONTACTS`
-   Avoid a generic `is_public` flag for sensitive business records.
-   Record invitations, access grants, revocations and important client
    actions in the audit history.
-   Support revoking client access without deleting commercial history.

### 4.3 Future roles

The data model should leave room for future workspace members and roles
such as administrator, project manager, finance manager and
collaborator. Full team permissions and collaboration workflows are not
required for the initial release.

## 5. Product Scope

### 5.1 In scope

1.  Authentication and workspace onboarding
2.  Dashboard / business overview
3.  CRM / clients and contacts
4.  Engagements and sales pipeline
5.  Proposal builder, preview, sharing and version history
6.  Agreements, signers, signatures and amendments
7.  Scope documents, versioning, freeze and approval
8.  Projects, milestones, tasks and dependencies
9.  Change requests and impact assessment
10. Finance: invoices, payments, allocations, credit notes, expenses and
    retainers
11. Client portal
12. Documents and reusable templates
13. Comments and email notifications
14. Calendar and deadlines
15. Activity timeline and audit events
16. Workspace and business settings

### 5.2 Out of scope for the initial release

-   SaaS subscription plans, tenant billing and public self-service
    signup for other freelancers.
-   Full accounting/general ledger or tax filing product.
-   Payroll and employee management.
-   Full real-time chat or presence indicators.
-   Native mobile applications.
-   Complex resource planning across large teams.
-   Microservices-based deployment.
-   Kafka or Kubernetes as mandatory infrastructure.
-   Automatic legal advice or guaranteed legal enforceability of
    generated agreements.
-   Automatic payment collection through a payment gateway unless
    separately prioritized.
-   AI-generated contractual or financial decisions without human
    review.

## 6. Information Architecture and Navigation

### 6.1 Freelancer workspace navigation

1.  Overview
2.  Clients
3.  Engagements
4.  Proposals
5.  Agreements
6.  Projects
7.  Scope & Changes
8.  Finance
9.  Documents
10. Calendar
11. Activity & Notifications
12. Settings

### 6.2 Client portal navigation

1.  Overview
2.  Proposals
3.  Agreements
4.  Project
5.  Scope
6.  Change Requests
7.  Documents
8.  Invoices
9.  Comments
10. Account Settings

Client navigation must be permission-aware. Hide unavailable sections
and prevent access through direct URLs or API calls.

## 7. Functional Requirements

Priority definitions: - **P0:** Required for a usable first release. -
**P1:** Important follow-on capability. - **P2:** Enhancement or later
release.

### 7.1 Authentication and onboarding

**Requirements** - P0: Freelancer can securely sign in and sign out. -
P0: First-time setup creates a workspace and owner association. - P0:
Capture business name, legal/business identity details where applicable,
contact information, address, default currency, timezone and locale. -
P0: Support password reset and session revocation. - P0: Client contacts
can accept an invitation and establish portal access. - P1: Client
contacts can use passwordless magic links. - P1: Workspace owner can
revoke invitations and portal access. - P1: Support configurable session
expiry and secure device/session management.

**Acceptance criteria** - An authenticated user can access only their
authorized workspace. - An expired, revoked or already-consumed
invitation cannot grant access. - A client portal user cannot access
another client organization's records by changing an identifier.

### 7.2 Dashboard / business overview

**Requirements** - P0: Show revenue received, outstanding receivables,
expected revenue and active project count. - P0: Show pending approvals
and attention-required items. - P0: Show proposal pipeline and recent
activity. - P0: Show upcoming deadlines and milestone dates. - P0:
Provide quick actions for creating a client, engagement, proposal,
project, invoice and document. - P1: Date filters for relevant dashboard
metrics. - P1: Global search across authorized records. - P1:
Configurable dashboard widgets.

**Rules** - Clearly distinguish cash received from invoiced revenue and
expected pipeline value. - Dashboard totals must use consistent currency
conversion rules. - Do not imply a proposal is revenue received or a
payment is revenue earned without a defined accounting treatment.

### 7.3 CRM --- clients and contacts

**Requirements** - P0: Create, view, edit and archive client records. -
P0: Support company and individual clients. - P0: Store client name,
type, status, primary contact, email, phone, website, address,
tax/business identifiers where applicable, notes and tags. - P0: Support
multiple contacts per company. - P0: Mark a primary contact and maintain
contact-level details. - P0: Search and filter by client name, contact,
email, type and relationship status. - P0: Client profile shows related
engagements, proposals, agreements, projects, invoices, documents and
activity. - P1: Record client interactions and relationship notes. - P1:
Import/export client records with validation and duplicate detection. -
P1: Support multiple billing and service addresses.

**Business rules** - A client is distinct from an engagement and
project. - A client may have multiple engagements. - A client may have
multiple contacts with different portal access. - Archiving a client
must not delete linked proposals, agreements, invoices, payments or
audit records. - Client revenue summaries must be derived from defined
financial records, not manually maintained totals.

**Acceptance criteria** - A client can be created with a minimum
required name and type. - A company can have multiple contacts and one
designated primary contact. - Searching and filtering update the
directory without losing unrelated records. - A client profile displays
only records associated with that client.

### 7.4 Engagements and sales pipeline

**Requirements** - P0: Create an engagement associated with a client. -
P0: Store engagement title, description, service category, estimated
value, currency, expected dates, source and owner. - P0: Support
configurable stages, for example: Lead, Qualified, Discovery, Proposal,
Negotiation, Won, Lost and On Hold. - P0: Record stage history with
actor, timestamp and optional reason. - P0: Link requirements and
discovery notes to an engagement. - P0: Create one or more proposals
from an engagement. - P1: Pipeline board and list views. - P1: Forecast
expected value using stage probability. - P1: Record lost reason and
follow-up date.

**Business rules** - An engagement may never become a project. -
Converting an engagement to a project must be an explicit action. -
Conversion must preserve the relationship to the originating client and
engagement. - A lost or abandoned engagement must remain available for
historical reporting.

### 7.5 Proposals

**Requirements** - P0: Create a proposal linked to a client and
optionally an engagement. - P0: Support proposal identity separate from
proposal versions. - P0: Provide reusable proposal templates and
editable sections. - P0: Support line items, quantities, rates,
discounts, tax, subtotal and total. - P0: Support pricing models: -
Fixed price - Milestone-based - Hourly - Daily - Time and materials -
Retainer - Hybrid - P0: Support payment terms, validity date,
assumptions, exclusions, deliverables and timeline. - P0: Generate a
client-readable preview and share it through the portal or secure
link. - P0: Client can accept, reject or request changes, with comments
where enabled. - P0: Record the exact proposal version and decision
timestamp. - P0: Accepted proposal versions are immutable. - P1: Compare
proposal versions. - P1: Duplicate a proposal as a starting point. - P1:
Support multi-currency proposal values.

**Business rules** - Proposal identity and proposal version are separate
entities. - Any edit to a shared proposal creates a new version. -
Acceptance references an exact version. - An accepted version cannot be
edited; create a new version or a replacement proposal. - Proposal
acceptance, agreement signature and scope approval are distinct
decisions.

### 7.6 Agreements and signatures

**Requirements** - P0: Create agreements from reusable templates. - P0:
Support editable agreement clauses and project-specific terms. - P0:
Link an agreement to a client, engagement and/or project as
appropriate. - P0: Define one or more signers, signer roles and signing
order where required. - P0: Track draft, sent, viewed, partially signed,
signed, declined, expired and voided states. - P0: Store signed
agreement documents and signature evidence/events. - P0: Preserve
immutable signed versions. - P1: Integrate with an e-signature
provider. - P1: Support agreement amendments/addenda. - P1: Reminders
for pending signatures and expiry.

**Business rules** - Signed agreement content is immutable. - Changes
after signing must be represented by a separate amendment/addendum. -
Signature provider events must be validated and processed
idempotently. - The system must distinguish an internal approval from a
legally meaningful external signature. - Product must not claim that a
template guarantees legal enforceability.

### 7.7 Scope management

**Requirements** - P0: Create a scope document associated with a project
and optionally linked to the accepted proposal/agreement. - P0: Define
requirements, features, deliverables, assumptions, exclusions and
acceptance criteria. - P0: Create and maintain scope versions. - P0:
Provide internal editing and client review. - P0: Support explicit
client approval of a specific scope version. - P0: Freeze an approved
scope version. - P0: Display scope version history and approval
history. - P1: Compare scope versions and highlight changes. - P1:
Generate a scope document for sharing or signing.

**Business rules** - A frozen scope cannot be edited directly. - Any
change to frozen scope must create a new scope version through an
authorized workflow. - Scope approval is distinct from proposal
acceptance and agreement signature. - An approval must reference the
exact scope version. - A change request approval must not silently amend
a signed agreement.

### 7.8 Projects, milestones and tasks

**Requirements** - P0: Create a project from an engagement or through an
authorized standalone workflow. - P0: Link project to client,
originating engagement, accepted proposal, agreement and approved scope
where applicable. - P0: Define project name, description, status, start
date, target date, owner and visibility. - P0: Create milestones with
names, descriptions, due dates, statuses and deliverables. - P0: Create
tasks with descriptions, priority, status, due date and optional
milestone. - P0: Support task dependencies. - P0: Track comments and
activity on project work. - P0: Provide list and board views. - P1:
Timeline/Gantt-style view. - P1: Client-visible progress summaries. -
P1: Milestone review and acceptance workflow. - P1: Attach files to
tasks, milestones and projects.

**Business rules** - Define one authoritative project progress
calculation strategy. Do not double-count milestone and task
completion. - Client-visible progress must be deliberately published. -
Task-level internal notes must not leak to the client portal. - Project
closure must preserve all historical records.

### 7.9 Change requests

**Requirements** - P0: Create change requests linked to a project and
relevant scope version. - P0: Capture request description, reason,
requester and requested date. - P0: Assess impact on cost, timeline,
deliverables, dependencies and risk. - P0: Record freelancer decision
and client decision. - P0: Support approve, reject, request
clarification and withdraw states. - P0: Link approved changes to a new
scope version. - P0: Maintain change request history and comments. - P1:
Generate a priced change proposal. - P1: Generate an agreement addendum
where required.

**Business rules** - Approved change requests do not automatically amend
a signed contract. - Where contractual terms require it, the addendum
must be completed before changed work begins. - The system must preserve
the original scope and show the delta introduced by approved changes. -
A rejected change request must not alter the baseline scope.

### 7.10 Finance

#### Invoices

**Requirements** - P0: Create invoices linked to a client and optionally
engagement/project/milestone. - P0: Support invoice line items,
quantity, rate, discounts, tax, due date, currency and payment terms. -
P0: Generate a printable/downloadable PDF. - P0: Support draft, issued,
partially paid, paid, overdue, void and credited states. - P0: Assign
unique invoice numbers safely under concurrent requests. - P0: Record
issue date, due date and historical invoice content. - P1: Recurring
invoice generation. - P1: Credit notes and invoice adjustments. - P1:
Configurable tax and numbering settings.

**Business rules** - Issued invoices must not be silently overwritten. -
Corrections after issuance must use a defined credit note, void/reissue
or adjustment workflow. - Invoice numbering must be concurrency-safe and
unique within the configured numbering scope. - Tax calculation and
rounding must use explicit currency precision and configured rules.

#### Payments and allocations

**Requirements** - P0: Record payments with amount, currency, date,
method, reference and notes. - P0: Allocate a payment across one or more
invoices. - P0: Support partial payment of an invoice. - P0: Show
unallocated payment balance. - P0: Preserve payment and allocation
history. - P1: Import payment records or integrate with a payment
provider. - P1: Refund and reversal records.

**Business rules** - A payment and an invoice are separate records. -
One payment may be allocated to multiple invoices. - An invoice may
receive multiple partial payments. - Payment retries and provider
webhooks must be idempotent. - Never delete a financial event to correct
it; use reversal/adjustment records.

#### Expenses

**Requirements** - P1: Record business expenses, date, vendor, category,
amount, currency, tax and receipt attachment. - P1: Filter expenses by
period and category. - P1: Include expenses in business overview
reporting.

#### Retainers

**Requirements** - P1: Define retainer contracts with fee, service
period, included hours/services, rollover/carry-forward policy and
excess usage rates. - P1: Generate retainer periods. - P1: Record period
consumption and remaining balance. - P1: Track overages and invoiceable
excess usage.

**Business rules** - Retainer contract terms are distinct from period
consumption. - Each service period must preserve its own allowance,
usage and carry-forward calculation. - Historical periods must not be
recalculated using changed current contract terms.

### 7.11 Documents and templates

**Requirements** - P0: Store and organize documents with metadata and
access controls. - P0: Support private file storage and version
history. - P0: Provide reusable templates for proposals, agreements,
scope documents, invoices and common client communications. - P0:
Generate PDF documents from structured records. - P0: Associate
documents with clients, engagements, proposals, agreements, projects,
change requests and invoices. - P0: Control internal/client visibility
and selected-contact sharing. - P1: Document preview and download audit
logs. - P1: Template duplication and versioning. - P1: E-signature
provider document handoff.

**Security requirements** - Store files in private object storage. - Use
short-lived signed URLs or authenticated download endpoints. - Validate
file type and size. - Scan uploads for malware where supported. - Do not
expose raw storage bucket paths or permanent public URLs.

### 7.12 Client portal

**Requirements** - P0: Provide a responsive, client-friendly portal. -
P0: Client can view their own organization profile and authorized
projects. - P0: Client can review proposals and submit decisions. - P0:
Client can review agreements and signing status. - P0: Client can view
approved scope and relevant version history. - P0: Client can submit and
review change requests. - P0: Client can view shared project milestones,
deliverables and progress. - P0: Client can access explicitly shared
documents. - P0: Client can view invoices and payment status. - P0:
Client can comment on supported shared records. - P0: Client can manage
their account and sign-in methods. - P1: Client can invite additional
authorized contacts, subject to owner approval/configuration. - P1:
Client can download shared PDFs and files.

**Business rules** - Client portal must be mobile-friendly. - Client
access is organization/contact/project/action scoped. - Client portal
APIs must return only client-visible fields. - A client cannot infer
internal-only notes, private documents or other clients' data through
search, IDs, pagination or error messages.

### 7.13 Comments, notifications and email

**Requirements** - P0: Support comments on relevant records, including
proposals, projects, scope and change requests. - P0: Each comment has
author, timestamp, parent record and visibility. - P0: Support email
notifications for invitations, proposal sharing/decisions, agreement
signatures, scope approvals, change request decisions, invoice issue/due
reminders and important project updates. - P0: Record notification
delivery attempts and outcomes. - P0: Allow user notification
preferences for supported categories. - P1: Comment attachments. - P1:
Notification digest and reminder schedules.

**Business rules** - Comments have explicit visibility. - Email delivery
is asynchronous. - Notification processing must be idempotent. - Failed
deliveries should be retryable and visible to administrators/owners. -
Email content must not include confidential details beyond the intended
recipient's authorization.

### 7.14 Calendar, activity and audit

**Requirements** - P0: Show upcoming milestones, task deadlines,
proposal expiry, invoice due dates and agreement signing deadlines. -
P0: Provide recent activity across relevant workspace records. - P0:
Record audit events for important actions. - P0: Capture actor,
timestamp, action, target object, object/version reference and relevant
metadata. - P1: Calendar filtering by event type and project. - P1:
Export calendar events. - P1: Search and filter audit history.

**Audit events should include** - Client and contact
creation/update/archive. - Engagement stage changes. - Proposal
creation, versioning, sharing and decisions. - Agreement creation,
sharing, signing, voiding and amendments. - Scope version creation,
approval and freeze. - Project and milestone state changes. - Change
request submission and decisions. - Invoice issue/void/credit. - Payment
creation, allocation, reversal. - Permission and portal access
changes. - Document sharing and access changes.

Audit history should be append-only for ordinary application users.

### 7.15 Settings

**Requirements** - P0: Business profile and branding. - P0: Default
currency, timezone and locale. - P0: Invoice numbering and document
numbering configuration. - P0: Tax settings and invoice defaults. - P0:
Proposal and agreement templates. - P0: Email and notification
preferences. - P0: Client portal branding and access settings. - P0:
Security and active session controls. - P1: Integrations and webhook
settings. - P1: Configurable pipeline stages and project statuses. - P1:
Data export and retention settings.

## 8. Core Workflows

### 8.1 Lead to project

1.  Create or identify a client.
2.  Create an engagement for the potential work.
3.  Record discovery requirements and interactions.
4.  Move the engagement through the pipeline.
5.  Create a proposal.
6.  Share a specific proposal version with the client.
7.  Client accepts, rejects or requests changes.
8.  If accepted, create an agreement as required.
9.  Obtain required signatures.
10. Create project from the engagement/accepted commercial terms.
11. Create the initial scope version.
12. Obtain scope approval and freeze it.
13. Start delivery.

### 8.2 Delivery and scope change

1.  Work is delivered through milestones, tasks and deliverables.
2.  Client or freelancer raises a change request.
3.  Freelancer assesses cost, schedule, risk and scope impact.
4.  Client reviews the assessment.
5.  If rejected, retain the decision without changing the baseline.
6.  If approved, create a new scope version.
7.  If contractual terms require it, create and sign an agreement
    addendum.
8.  Begin changed work only when required approvals and contractual
    conditions are complete.

### 8.3 Invoice and payment

1.  Create invoice from agreed commercial terms, milestone, retainer or
    approved additional work.
2.  Validate invoice lines, tax, currency, numbering and due date.
3.  Issue and preserve invoice version.
4.  Share invoice with the client.
5.  Record incoming payment.
6.  Allocate payment to one or more invoices.
7.  Recalculate outstanding balances from allocations.
8.  Issue receipt/confirmation where supported.
9.  Preserve adjustment, refund or reversal history.

## 9. Domain Model and Data Architecture

The database should use PostgreSQL with explicit relational constraints.
The following is the logical domain inventory; final physical schema and
field-level design will be produced during technical design.

### 9.1 Identity and access

-   users
-   workspaces
-   workspace_memberships
-   client_organizations
-   organization_memberships
-   invitations
-   user_sessions
-   access_tokens
-   client_project_access
-   permission_overrides

### 9.2 CRM

-   clients
-   client_contacts
-   client_addresses
-   client_interactions

### 9.3 Engagements

-   engagements
-   engagement_requirements
-   engagement_stage_history

### 9.4 Proposals

-   proposals
-   proposal_versions
-   proposal_sections
-   proposal_line_items
-   proposal_payment_terms
-   proposal_decisions

### 9.5 Agreements

-   agreements
-   agreement_versions
-   agreement_signers
-   signature_events
-   agreement_amendments

### 9.6 Scope

-   scope_documents
-   scope_versions
-   scope_requirements
-   scope_deliverables
-   scope_version_requirements
-   scope_approvals

### 9.7 Projects

-   projects
-   milestones
-   tasks
-   task_dependencies
-   milestone_deliverables
-   milestone_approvals

### 9.8 Change management

-   change_requests
-   change_request_assessments
-   change_request_decisions
-   change_request_scope_links

### 9.9 Finance

-   invoices
-   invoice_line_items
-   payments
-   payment_allocations
-   credit_notes
-   expenses
-   retainer_contracts
-   retainer_periods
-   retainer_entries

### 9.10 Documents

-   documents
-   document_versions
-   document_templates
-   document_access_logs

### 9.11 Communication

-   comments
-   comment_attachments
-   notifications
-   notification_deliveries
-   email_events

### 9.12 Audit and configuration

-   audit_events
-   workspace_settings
-   currencies
-   exchange_rates
-   number_sequences

### 9.13 Key relationships

-   Workspace owns its internal business records.
-   Workspace has clients.
-   Client has contacts and multiple engagements.
-   Engagement has requirements, stage history and proposals.
-   Proposal has immutable versions, sections, line items, payment terms
    and decisions.
-   Engagement may lead to a project.
-   Agreement has versions, signers, signature events and amendments.
-   Project has scope documents, milestones, tasks and change requests.
-   Scope document has versions; approvals reference exact versions.
-   Change requests link to the scope version they seek to change.
-   Invoice may relate to client, engagement, project, milestone or
    approved change.
-   Payment has one or more payment allocations.
-   Documents may be associated with multiple business records through
    explicit association tables or carefully modeled foreign keys.
-   Comments and notifications reference supported records using a
    design that preserves authorization and referential integrity.

### 9.14 Data integrity rules

-   Prefer explicit foreign keys and association tables. Avoid
    unconstrained polymorphic `entity_type/entity_id` references for
    critical relationships.
-   Use PostgreSQL `NUMERIC` or integer minor units for money;
    JavaScript floating-point numbers must not be authoritative for
    financial calculations.
-   Store currency code and explicit currency precision with monetary
    values.
-   Store original transaction amounts and historical exchange rates.
    Never rewrite historical records using today's FX rate.
-   Use UTC for stored timestamps and render in configured
    user/workspace timezone.
-   Use immutable version records for accepted proposals, signed
    agreements, approved scope and issued invoices.
-   Use append-only audit events for important state changes.
-   Archive rather than cascade-delete historical business records.
-   Use database transactions for critical multi-record operations.
-   Use idempotency keys for payment processing, provider webhooks and
    notification jobs.
-   Enforce unique invoice numbers through database constraints and
    concurrency-safe number sequences.
-   Record who performed approvals and the exact version/object
    approved.

## 10. Non-Functional Requirements

### 10.1 Security and privacy

-   Enforce authentication and authorization on every protected API.
-   Apply workspace-level data isolation.
-   Apply client organization/contact/project-level access controls.
-   Use secure password hashing and secure token generation.
-   Store secrets outside source control.
-   Use TLS for network communication.
-   Encrypt sensitive data at rest where supported by the
    infrastructure.
-   Use short-lived signed URLs for private file access.
-   Rate-limit authentication, magic-link and sensitive endpoints.
-   Protect against common web vulnerabilities, including injection,
    XSS, CSRF where applicable, SSRF and insecure direct object
    references.
-   Maintain audit trails for security-sensitive events.
-   Provide a data export and deletion/retention policy consistent with
    applicable law and contractual requirements.

### 10.2 Performance

Initial targets to validate under realistic workloads: - Common
authenticated page/API operations should generally complete within 500
ms at the 95th percentile, excluding external provider latency and large
file operations. - Search and filtering should remain responsive for a
typical freelancer workspace with thousands of records. - PDF
generation, email and other slow tasks should run asynchronously. - Use
pagination for large record lists. - Avoid unbounded queries and N+1
database access.

### 10.3 Availability and reliability

-   Define production availability and recovery targets before launch.
-   Use automated database backups and test restoration.
-   Retry transient background job failures with bounded backoff.
-   Dead-letter or surface jobs that repeatedly fail.
-   Ensure critical financial and approval operations are
    transactionally safe.
-   Monitor application errors, queue health, database health and email
    delivery.

### 10.4 Accessibility and usability

-   Aim for WCAG 2.1 AA for primary user journeys.
-   Support keyboard navigation and visible focus states.
-   Use accessible form labels, validation messages and status
    indicators.
-   Do not rely on color alone to communicate status.
-   Provide useful empty, loading, error and confirmation states.

### 10.5 Responsive behavior

-   Freelancer workspace: desktop-first, responsive for tablet and
    mobile where practical.
-   Client portal: mobile-friendly and responsive from the first
    release.
-   Tables should have an intentional narrow-screen strategy, such as
    horizontal scrolling or compact cards.

### 10.6 Localization

-   INR is the default currency for the initial workspace configuration.
-   Support multiple currencies at the data and UI levels.
-   Support configurable date, number and timezone formatting.
-   Do not assume all client addresses or tax identifiers are Indian.

## 11. UX and Design System

### 11.1 Visual direction

-   Premium minimal, inspired by the clarity and density of modern
    productivity tools.
-   Light theme initially.
-   Collapsible left navigation.
-   Neutral surfaces, restrained status colors and clear typography.
-   Balanced information density: compact enough for professional
    workflows without feeling crowded.
-   Consistent buttons, inputs, tables, drawers, modals, badges, cards
    and empty states.

### 11.2 Layout conventions

-   Persistent workspace sidebar.
-   Compact top header with breadcrumbs, global actions and account
    controls.
-   Page title, concise description and one primary action.
-   Summary cards only where they help decisions.
-   Search and filters close to the data they control.
-   Detail drawers for quick inspection; full detail pages for complex
    records.
-   Explicit confirmation for irreversible or commercially important
    actions.

### 11.3 Client portal design

-   Responsive layout optimized for phone and desktop.
-   Clear separation of actions requiring client attention from
    informational content.
-   Obvious proposal, agreement, scope and change request decision
    states.
-   No internal-only navigation, data or terminology.

### 11.4 Screen inventory

**Freelancer workspace** 1. Authentication and onboarding 2. Dashboard
3. Client listing and CRM 4. Client profile and contacts 5. Engagement
listing and pipeline 6. Engagement details 7. Proposal listing 8.
Proposal builder 9. Proposal preview and sharing 10. Proposal version
history 11. Agreement listing 12. Agreement builder and signer setup 13.
Agreement detail and signature tracking 14. Project listing 15. Project
overview 16. Milestones and task management 17. Scope overview and
editor 18. Scope review, approval and version history 19. Change request
listing and creation 20. Change request impact assessment and decisions
21. Finance overview 22. Invoice listing and builder 23. Invoice detail
and payment recording 24. Retainers and service periods 25. Document
library and templates 26. Calendar 27. Activity and notifications 28.
Workspace settings

**Client portal** 1. Client sign-in and invitation acceptance 2. Client
dashboard 3. Proposal review and decision 4. Agreement review and
signing 5. Project overview 6. Scope review and approval 7. Change
request review 8. Shared documents 9. Invoices and payment status 10.
Comments and account settings

## 12. Technical Architecture

### 12.1 Recommended initial stack

  -----------------------------------------------------------------------
  Layer                               Proposed technology
  ----------------------------------- -----------------------------------
  Freelancer web app                  Next.js, TypeScript

  Client portal                       Next.js, TypeScript

  UI                                  Tailwind CSS and shadcn/ui

  Backend                             NestJS modular monolith,
                                      TypeScript, REST API

  Database                            PostgreSQL

  ORM                                 Prisma

  Cache and job queue                 Redis and BullMQ

  File storage                        Private S3-compatible object
                                      storage

  Email                               Transactional email provider

  PDF generation                      Server-side HTML-to-PDF or a
                                      suitable PDF rendering service

  E-signature                         Provider integration behind an
                                      adapter

  Deployment                          Managed application/container
                                      hosting and managed
                                      PostgreSQL/Redis
  -----------------------------------------------------------------------

### 12.2 Architecture principles

-   Start with a modular monolith organized by business domain.
-   Keep domain boundaries clear so modules can be extracted later if
    justified.
-   Avoid microservices, Kafka and Kubernetes as initial requirements.
-   Keep external provider integrations behind adapters.
-   Use REST APIs with explicit DTO validation and authorization.
-   Use background workers for email, PDF generation, reminders and
    webhook processing.
-   Store files outside the relational database, with metadata and
    access control in PostgreSQL.
-   Use migrations and automated tests for schema changes.

### 12.3 Suggested backend modules

-   AuthModule
-   WorkspaceModule
-   ClientsModule
-   EngagementsModule
-   ProposalsModule
-   AgreementsModule
-   ScopeModule
-   ProjectsModule
-   ChangeRequestsModule
-   FinanceModule
-   DocumentsModule
-   ClientPortalModule
-   CommentsModule
-   NotificationsModule
-   CalendarModule
-   AuditModule
-   SettingsModule
-   IntegrationsModule

### 12.4 Integration requirements

-   Email provider for transactional notifications.
-   Object storage for private files and generated PDFs.
-   E-signature provider for signature workflows.
-   Optional payment gateway integration in a later phase.
-   Optional calendar integration in a later phase.
-   Webhook verification, replay protection and idempotent processing
    for all providers.

## 13. API and System Behavior Guidelines

-   Use consistent resource-oriented REST endpoints.
-   Validate request payloads at the API boundary.
-   Enforce authorization in the service layer, not only in the UI.
-   Use pagination, sorting and filtering for collection endpoints.
-   Return stable error codes and actionable validation messages.
-   Use optimistic concurrency/version checks for records that may be
    edited by multiple actors.
-   Use idempotency keys for operations that may be retried.
-   Record audit events as part of the same transaction for critical
    state changes where feasible.
-   Do not expose internal database identifiers as authorization tokens.
-   Separate client-facing response DTOs from internal workspace DTOs.

### Critical transactional operations

The following should execute atomically where their data changes are
coupled: - Accept proposal version. - Freeze/approve scope version. -
Approve change request and create resulting scope version. - Issue
invoice and reserve invoice number. - Record payment and allocations. -
Finalize agreement signature state. - Revoke or grant client access.

## 14. Reporting Requirements

Initial reporting: - Revenue received by period. - Outstanding
receivables and ageing. - Issued invoices and payment status. - Proposal
pipeline by stage and expected value. - Proposal acceptance rate. -
Active projects and project status. - Milestone completion and overdue
work. - Change request volume and approved/rejected value. - Retainer
usage and remaining balances. - Client-level engagement and financial
summary.

Reporting definitions must be documented. For example, distinguish
invoice value, cash received, outstanding balance and forecast pipeline.

## 15. Data Migration and Import

P1 capabilities: - Import clients and contacts from CSV. - Validate
required columns and formats. - Preview rows before committing. - Detect
likely duplicates using configurable matching rules. - Report failed
rows with reasons. - Preserve source identifiers where useful. - Export
workspace data in common formats. - Never import financial records
without explicit currency and date validation.

## 16. Testing and Quality Strategy

### 16.1 Unit tests

-   Pricing and tax calculations.
-   Currency precision and rounding.
-   Invoice numbering.
-   Payment allocation and outstanding balance calculations.
-   Proposal and scope version transitions.
-   Permission evaluation.
-   Retainer period consumption.
-   Project progress aggregation.

### 16.2 Integration tests

-   Database transaction boundaries.
-   Critical workflow transitions.
-   File upload/download authorization.
-   Email job creation and retry.
-   Webhook signature verification and idempotency.
-   E-signature event handling.
-   Client portal access isolation.

### 16.3 End-to-end tests

-   Freelancer onboarding.
-   Create client and contact.
-   Create engagement and proposal.
-   Share proposal and accept exact version as client.
-   Create agreement and complete signing flow in test mode.
-   Create project and approve scope.
-   Submit and approve a change request.
-   Issue invoice, record partial payment and allocate it.
-   Verify client portal visibility and access restrictions.

### 16.4 Security tests

-   Cross-workspace access attempts.
-   Cross-client organization access attempts.
-   IDOR and permission bypass attempts.
-   Expired/revoked invitation and magic-link tests.
-   File access and signed URL expiry tests.
-   Rate-limit and abuse tests for authentication endpoints.

## 17. Release Plan

### Phase 0 --- Foundation

-   Repository and application setup.
-   Authentication and workspace model.
-   Database migrations and audit foundation.
-   Design system and responsive shell.
-   CI, environments, logging and error monitoring.

### Phase 1 --- Client and sales foundation

-   Dashboard.
-   Client directory and client profile.
-   Contacts.
-   Engagements and pipeline.
-   Search, filters and basic activity.

### Phase 2 --- Commercial documents

-   Proposal builder, versioning and client decisions.
-   Agreement builder, signer configuration and signature tracking.
-   Document templates and PDF generation.

### Phase 3 --- Delivery and scope control

-   Project creation and overview.
-   Scope documents, versions, approvals and freeze.
-   Milestones, tasks and dependencies.
-   Change requests and impact assessment.

### Phase 4 --- Finance

-   Invoice builder and numbering.
-   Payment records and allocations.
-   Credit notes and expenses.
-   Retainer contracts and service periods.

### Phase 5 --- Client portal and communications

-   Client authentication and organization access.
-   Client dashboard and shared records.
-   Comments and email notifications.
-   Client document access and activity.

### Phase 6 --- Hardening and launch

-   Security and permission audit.
-   Performance testing.
-   Backup/restore verification.
-   Data export and retention workflows.
-   End-to-end regression testing.
-   Production monitoring and operational runbooks.

Phases can overlap after domain contracts and critical data models are
stable. Final sequencing should be confirmed during implementation
planning.

## 18. MVP Definition

A practical MVP should let one freelancer manage a real client
engagement from lead through delivery and payment.

**MVP must include** - Secure owner authentication and one workspace. -
Client and contact management. - Engagement pipeline. - Proposal
creation, versioning and client acceptance. - Basic agreement records
and signature status; provider-backed e-sign may follow if it delays
MVP. - Project creation. - Scope creation, versioning, approval and
freeze. - Milestones and tasks. - Change request workflow. - Invoice
creation and PDF. - Manual payment recording and allocation. - Basic
client portal. - Client-visible documents and comments. - Email
notifications for critical actions. - Audit history for critical
commercial and financial actions.

**MVP may defer** - Full expense management. - Advanced retainer
accounting. - Automated payment gateway collection. - Calendar
integrations. - Advanced analytics and configurable dashboards. -
Complex multi-user workspace roles. - Advanced template marketplace.

## 19. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                    Impact                  Mitigation
  ----------------------- ----------------------- -----------------------
  Scope creep from        Delayed launch          Enforce phased MVP and
  all-in-one ambition                             explicit priorities

  Contract and scope      Commercial disputes     Separate proposal,
  state ambiguity                                 agreement and scope
                                                  approvals

  Client data leakage     Severe privacy risk     Explicit visibility
                                                  model and authorization
                                                  tests

  Financial rounding      Incorrect balances      Decimal/minor-unit
  errors                                          arithmetic and
                                                  currency-aware tests

  Duplicate payment       Incorrect receivables   Idempotency and
  processing                                      immutable payment
                                                  events

  Concurrent invoice      Duplicate invoice IDs   Database constraints
  numbering                                       and transactional
                                                  sequences

  E-sign provider         Workflow interruption   Provider adapter and
  dependency                                      manual status fallback

  Email delivery failure  Missed approvals        Delivery tracking,
                                                  retries and in-app
                                                  attention centre

  Unclear project         Misleading dashboard    One documented progress
  progress                                        aggregation strategy

  Excessive architecture  Higher cost and slower  Modular monolith and
  complexity              iteration               managed infrastructure
  -----------------------------------------------------------------------

## 20. Open Decisions Before Implementation

The following decisions should be finalized during detailed design:

1.  Authentication provider versus fully managed authentication in the
    application.
2.  E-signature provider and acceptable fallback process.
3.  Transactional email provider.
4.  PDF rendering approach and document branding capabilities.
5.  Whether payment gateway collection is required in the first public
    release.
6.  Exact Indian tax/GST invoice configuration and compliance
    requirements; obtain professional review before treating generated
    invoices as tax-compliant.
7.  Invoice numbering scope: workspace-wide, financial-year-based or
    configurable.
8.  Whether client contacts can invite other contacts or only the
    workspace owner can.
9.  Retainer carry-forward and expiry policy options.
10. Exact reporting definitions for revenue, expected revenue and
    outstanding amounts.
11. Backup retention, recovery point and recovery time objectives.
12. Data retention and deletion policy.

## 21. Definition of Done

A feature is complete when: - The relevant workflow is implemented in
the UI and API. - Authorization is enforced server-side. - Validation
and error states are designed. - Empty, loading and success states are
present. - Audit events are recorded for important actions. - Critical
state transitions are transactionally safe. - Automated tests cover
business rules and failure cases. - Client-visible information is
checked for correct visibility. - Responsive behavior is verified for
the intended devices. - Relevant documentation and operational notes are
updated.

------------------------------------------------------------------------

## Appendix A --- Core Terminology

  -----------------------------------------------------------------------
  Term                                Meaning
  ----------------------------------- -----------------------------------
  Workspace                           The freelancer's private business
                                      environment

  Client                              The external company or individual
                                      purchasing services

  Contact                             A person associated with a client

  Engagement                          A potential or active commercial
                                      opportunity

  Proposal                            A priced offer describing proposed
                                      work and terms

  Proposal version                    An immutable revision of a proposal

  Agreement                           A contractual record between the
                                      freelancer and client

  Scope                               The approved description of
                                      included work and deliverables

  Scope version                       A revision of the scope document

  Project                             The delivery container for agreed
                                      work

  Milestone                           A major delivery checkpoint

  Task                                A unit of work within a project

  Change request                      A request to alter approved scope,
                                      schedule or cost

  Invoice                             A request for payment

  Payment                             Money received and recorded

  Payment allocation                  The amount of a payment applied to
                                      an invoice

  Retainer                            A recurring commercial arrangement
                                      with defined service allowance

  Client portal                       The controlled external interface
                                      for client review and action
  -----------------------------------------------------------------------

## Appendix B --- Non-Negotiable Business Rules

1.  Client, engagement and project are separate entities.
2.  One client may have multiple engagements.
3.  An engagement may not become a project automatically.
4.  Accepted proposal versions are immutable.
5.  Signed agreement versions are immutable.
6.  Scope approval references an exact scope version.
7.  Frozen scope cannot be edited directly.
8.  Change request approval does not silently amend a signed contract.
9.  Invoices and payments are separate records.
10. Payments can be partially allocated or split across invoices.
11. Invoice numbering must be concurrency-safe.
12. Original currency and historical FX must be preserved.
13. Client visibility must be explicit and permission-checked.
14. Important actions must be auditable.
15. Historical commercial and financial records must not be
    cascade-deleted.
16. Financial calculations must not rely on JavaScript floating-point
    arithmetic.
17. Critical multi-record operations must be transactional.
18. Payment and notification processing must be idempotent.
19. Project progress must use one documented aggregation method.
20. Client portal access must be scoped to the correct organization,
    contact, project and action.
