# Recon map: Finsy, inspired by savemoney.cl (iOS + Android, web dashboard later)

**Path override:** this working directory already holds an unrelated,
unfinished Replica-pack project at `replica/` (a clone of the SNOW camera
app). None of that is touched. Every file for this project lives under
`finsy-clone/replica/` instead.

Scope: the core loop only — connect a bank account through a licensed
aggregator, see balances and transactions auto-categorized, chat with the AI
assistant about spending, and set one budget with an alert. Out of scope for
this slice: the discounts/offers map, shared/household accounts, bill-
splitting ("me deben"), card-installment tracking, and the paid-plan paywall
— see "Out of scope" below for what of that is skip vs. just later.

For: the user's own product — a personal-finance app that really connects to
their own bank account and tracks spending automatically. Inspired by the
category savemoney.cl competes in, not a 1:1 brand clone: own name, own AI
persona, own visual identity (already sketched in the Design-canvas concept
"Finsy", 4 screens, this session).

Date: 2026-11-13

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (scraped this session) | https://savemoney.cl/ | hero pitch, 3-step "cómo funciona", security section, feature list, testimonials, partner discounts, 3 pricing tiers |
| 2 | homepage screenshot (captured this session) | https://savemoney.cl/ | visual style only: deep navy/indigo bg, bold white/blue-accent type, rounded buttons, phone mock with discounts map |
| 3 | own early UI sketch (this session, Design canvas) | internal artifact, not a public source | 4 screens drafted before this recon — treated as a hypothesis to check against this map, not evidence of the real app |

Not yet covered, recommended before `/replica-build`: the App Store / Google
Play listings (screenshots of every real screen + exact permissions
requested), a help-center article on "¿qué bancos puedo conectar?" (the FAQ
teaser on the site names the question but the answer wasn't expanded during
the scrape), and — if the user ever creates a real SaveMoney account for
comparison — a live click-through, never used as a source of code or assets,
only of UX flow.

## Core loop

Connect a bank account once; from then on every new transaction shows up
already categorized, rolled into a monthly budget view, and the AI assistant
can answer "how am I doing this month" or log a manual expense from a
sentence, a voice note, or a receipt photo.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome / value prop | app launch, first run, logged out | pitch the assistant, get to sign-up | Chat-prompt preview card, CTA buttons | logged-out only |
| S02 | Sign up / log in | from S01 | create an account or return to one | Email/password or OAuth form | empty, error (bad credentials), loading |
| S03 | Connect your bank | first run after signup, or Settings > "Conectar banco" | hand off to the aggregator's consent + bank-login widget | Bank picker list, aggregator webview/SDK, consent screen (aggregator's own UI, not ours) | picking bank, in aggregator flow, success, failed/cancelled, bank not supported |
| S04 | Home / dashboard | app home, post-connection | monthly balance, budget progress, category breakdown, recent transactions | Balance/budget card, category row, transaction row, bottom nav | loading (first sync), empty (zero transactions yet), filled, sync error |
| S05 | Transaction list | Home > "Ver todo" | full scrollable/searchable transaction history | Transaction row, search/filter bar, date grouping | empty, filled, filtered-empty |
| S06 | Transaction detail | tap a transaction | see and correct category, merchant, notes | Category picker, merchant name (raw vs. cleaned), amount, account badge | default, editing |
| S07 | Categories & budgets | Home > category row > "Ver todo", or its own tab | per-category spend vs. budget, edit budget caps | Category list, progress bar, budget editor modal | no budgets set, filled, over-budget (warning state) |
| S08 | Chat with the assistant | bottom nav "Chat" | ask questions about spending, log a manual expense (text, voice, receipt photo) | Chat bubble (user/assistant), inline data card (spend recap), quick-action chips, input bar with mic + camera | empty/first-open, typing, assistant-thinking, error (couldn't parse receipt) |
| S09 | Manual expense capture | from S08, or a "+" action on S04/S05 | log a cash/offline expense by hand when there's no bank connection, or top up a free-tier account | Amount field, category picker, date, note, optional receipt photo | empty, photo-processing, saved |
| S10 | Settings / security & account | profile tab | manage linked banks (disconnect), delete account/data, notification prefs | Linked-accounts list, "disconnect" action with confirmation, delete-account flow | default, disconnect-confirm, account-deleted |

Noted as real in savemoney.cl but **out of scope for this slice** (see Out of
scope / later): discounts map, shared/household accounts, "me deben" bill
splitting, card installments, upgrade/paywall screen.

## Flows

```
F01 Connect a bank and see categorized transactions (the core loop)
    S01 -> S02 -> S03 (aggregator consent, outside our UI) -> S04 (first sync, loading) -> S04 (filled)
    happy path clicks: 5 (sign up, pick bank, log in at the bank, consent, land on dashboard)
    edge: bank not supported by the aggregator, user cancels mid-consent, aggregator sync delay/timeout,
          duplicate transactions on a second sync, bank requires 2FA step inside the aggregator widget

F02 Ask the assistant about this month's spending
    S04 -> S08 -> (assistant reads the user's own transactions/budgets) -> inline recap card
    happy path clicks: 2 (open chat, send question)
    edge: no transactions yet ("conecta tu banco primero"), ambiguous question, assistant must not
          invent numbers it cannot compute from the user's real data

F03 Log a manual expense from the chat
    S08 -> (type a sentence, or attach a photo of a receipt) -> assistant confirms amount/category -> S04 updates
    happy path clicks: 2 (attach/type, confirm)
    edge: blurry receipt photo, amount not recognised, user corrects the category after the fact (-> S06)

F04 Set a budget and get warned near the limit
    S07 -> edit a category's budget cap -> save -> (later) a transaction pushes spend over 80% -> notification
    happy path clicks: 3 (open category, set amount, save)
    edge: no budget set yet (first-run empty state), budget edited mid-month (recompute from month start,
          not from edit date), multiple categories over budget at once
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost | default, hover/press, disabled, loading | all |
| Input (text) | single-line, multi-line note | default, focus, error, disabled | S02, S06, S09 |
| Balance/budget card | monthly summary | loading, filled, over-budget | S04 |
| Category row | with icon, with progress bar | default, over-budget (warning color) | S04, S07 |
| Transaction row | income, expense, pending | default, uncategorized (flag), editing | S04, S05, S06 |
| Chat bubble | user, assistant, assistant-with-data-card | sending, sent, thinking (assistant) | S08 |
| Quick-action chip | text label | default, pressed | S08 |
| Bank picker list item | logo + name | default, unsupported (disabled) | S03 |
| Progress bar | budget usage, sync progress | normal, warning (>80%), over (>100%) | S04, S07 |
| Bottom nav | 3-4 tabs | active, inactive | S04, S05, S07, S08 |
| Confirmation modal | destructive (disconnect bank, delete account) | default, confirming, done | S10 |

## Inferred data model

```
User            id, email, auth_provider, created_at
                evidence: S02 sign-up form, S10 account settings
                confidence: high

BankConnection  id, user_id, aggregator_item_id, institution_name, status
                (active | error | disconnected), last_synced_at
                evidence: S03 connect flow, S04 "sync error" state, S10 disconnect action,
                          site's security section (aggregator = "Kripta" in the original; we use
                          a licensed provider such as Fintoc/Belvo, never our own bank login form)
                confidence: high (that a connection-item record exists) / guess (exact status enum)

Account         id, bank_connection_id, user_id, type (checking | credit_card | ...),
                last4, currency, current_balance
                evidence: S04 account badge on transactions, S10 linked-accounts list
                confidence: medium

Transaction     id, account_id, user_id, posted_at, amount_cents, currency,
                raw_description, clean_description, category_id, source
                (bank_sync | manual | receipt_photo), notes
                evidence: S05/S06 (raw vs. "cleaned" merchant name is an explicit feature on the
                          site — "movimientos que se entienden"), S09 manual entry
                confidence: high

Category        id, user_id (null = system default), name, icon, parent_category_id
                evidence: S04 category rows, S06 category picker, site's "categorías que aprenden"
                confidence: high

Budget          id, user_id, category_id, month, cap_cents
                evidence: S07, site's "presupuestos" feature
                confidence: high

ChatMessage     id, user_id, role (user | assistant), content, created_at,
                linked_transaction_id (nullable, for "I logged this expense" replies)
                evidence: S08, site's chat-assistant feature
                confidence: medium (linked_transaction_id is inferred, not confirmed)
```

Relationships: User 1-n BankConnection, BankConnection 1-n Account, Account
1-n Transaction, User 1-n Category (plus shared system categories),
Category 1-n Transaction, User/Category 1-n Budget (one per month),
User 1-n ChatMessage.

## Feature matrix

See `features.csv`. Must: 9, should: 7, could: 4, skip: 4.

## Out of scope (cannot or should not be cloned)

- **Their own bank-connection technology ("Kripta").** Reading a user's bank
  password directly and scraping their bank is not something to rebuild —
  it is also a regulated activity. Finsy connects through a licensed
  account-aggregation API (e.g. Fintoc or Belvo for Chile/LatAm) and never
  stores or even sees the user's real bank password.
- **Partner discount deals (Rappi, Entel, WHOOSH, Deep).** Those are business
  relationships savemoney.cl negotiated, not a feature to copy — Finsy's own
  discounts map (phase 2, see below) would need its own merchant partners.
- **Their brand and persona** — the name SaveMoney, the assistant name
  "Lisa", the aggregator name "Kripta", the "SaverPlus" plan name. Finsy uses
  its own naming throughout.
- **Their existing users, reviews and the "+150.000 personas" stat.** Not a
  feature, not transferable, and not something to claim for a new product.

**Later / phase 2, not cut, just not in this slice:** discounts map tied to
linked cards, shared/household accounts, "me deben" bill-splitting, card
installment tracking, the free-vs-paid plan gate itself (ship the paid
feature set first, decide pricing once the core loop works).

## Size

Screens 10 (+5 later), flows 4, entities 7. Hard parts: the bank-aggregator
integration and its compliance/security surface (even though it's someone
else's licensed API, the consent flow, webhook sync and error states are
real engineering), getting transaction auto-categorization accurate enough
to feel "automatic" rather than annoying, and grounding the chat assistant's
answers strictly in the user's real stored data (no invented numbers) while
still letting it write back (log an expense, change a category) safely.
Size: **L** — a bank-connected finance app with an AI assistant is a
quarter-scale project, not a weekend clone; the vertical slice in
`/replica-architect` should prove the stack with one bank, one account,
real transactions, before any of the "later" features.
