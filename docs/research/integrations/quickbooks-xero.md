# Accounting: QuickBooks Online and Xero

Researched 2026-10-21 from primary sources: Intuit Developer docs and the Intuit App Partner Program Guide v1.2 (03.2026); Xero Developer docs, pricing page and Developer Platform Terms (last updated 2025-12-04); Nango `providers.yaml`. Claims marked **(unverified)** were not checked against a primary source in this pass.

## How accounting maps onto Mycel's risk scale

The key question is **whether a write posts to the ledger**. A posted transaction changes the company's books: revenue, accounts receivable (AR), accounts payable (AP), tax reports. Undoing it means a void or a delete. A non-posting document changes nothing in the books until a person approves or converts it.

| Kind of write                               | Examples                                                                                                                                                                                                     | Proposed level                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Reads, reports, PDFs, online-invoice links  | invoices, contacts, aged receivables, P&L                                                                                                                                                                    | `read`                                                                                      |
| Master data                                 | create or update a customer, contact, vendor or item; archive a contact                                                                                                                                      | `internal_reversible`                                                                       |
| Non-posting documents                       | Xero invoice or bill in `DRAFT`/`SUBMITTED`; Xero quote `DRAFT`; Xero PO `DRAFT`; QBO Estimate; QBO PurchaseOrder                                                                                            | `internal_reversible`                                                                       |
| Annotations                                 | QBO Attachable; Xero attachment; Xero history note                                                                                                                                                           | `internal_reversible`, but Xero attachments and notes **cannot be removed through the API** |
| Emailing a document from the accounting app | QBO `/invoice/{id}/send`, `/estimate/{id}/send`, `/purchaseorder/{id}/send`; Xero `/Invoices/{id}/Email`                                                                                                     | `external_send`                                                                             |
| Posting transactions                        | QBO Invoice, Bill, Payment, BillPayment, Purchase, SalesReceipt, CreditMemo, JournalEntry, Deposit, Transfer; Xero setting `AUTHORISED`, Payments, BankTransactions, ManualJournals, credit-note allocations | **`financial`**                                                                             |
| Moving real money                           | QuickBooks Payments API charges (`com.intuit.quickbooks.payment`); Xero payment services                                                                                                                     | **`financial`**                                                                             |
| Void and delete                             | QBO void or delete of any transaction; Xero `VOIDED`, `DELETED` on a document that was not Mycel's own pending item, deleting an item                                                                        | **`destructive`**                                                                           |

Two judgement calls for the team:

1. **Is a QBO invoice `financial` the moment it is created?** I recommend yes. QBO has no draft or unsent state for invoices in the API. A new invoice posts to AR and revenue immediately; `EmailStatus` = `NotSet`/`NeedToSend` only records whether it has been emailed. Declining it would then need a delete or void (`destructive`). Xero is different: `DRAFT` and `SUBMITTED` invoices create no journals ("No journals are created so the details will not be used in any reports"), so they are a true pending form.
2. **Is "send an invoice" `financial` or `external_send`?** Emailing creates no ledger entry; the money effect happened (QBO) or happens (Xero `AUTHORISED`) at posting. I propose `external_send` for the email, with the posting step classified separately. In Xero, the API can email an invoice that is still `SUBMITTED` (not yet approved), so a design must stop Mycel from emailing unapproved invoices.

### Useful workflows that need only `read`, `internal_reversible` and `external_send`

1. **Overdue-invoice chasing (both apps).** Read open invoices or the aged-receivables report. Write a Gmail draft reminder that includes the invoice's online link (Xero `GET /Invoices/{id}/OnlineInvoice`; QBO `InvoiceLink` via `include=invoiceLink`, only when online payment is enabled). A person sends it. Uses `read` plus the existing Gmail pending form.
2. **Bill capture from email (Xero).** A supplier invoice arrives in Gmail. A model step extracts the fields. Mycel creates an `ACCPAY` invoice in `DRAFT` or `SUBMITTED` with the PDF attached, and a person approves it in Xero. In QBO the same workflow is `financial`, because a Bill posts to AP.
3. **Quote or estimate from an enquiry.** Mycel drafts a Xero quote (`DRAFT`) or a QBO Estimate (non-posting). QBO can send the estimate as an `external_send` (`/estimate/{id}/send`). Xero has no quote-email endpoint, so its quote goes out through a Gmail draft or from Xero by the person.
4. **Draft invoice from finished work (Xero).** Signed-off timesheets in Sheets, or an accepted quote, become a `SUBMITTED` invoice in Xero's "Awaiting approval" list. The person approves and sends it in Xero, and Mycel's check reads it as `done_in_app`.
5. **Contact upkeep, payment notices and digests.** Create or update a contact from a new-customer email. Invoice webhook → `PAID` → a Sheets row or a thank-you Gmail draft. A weekly AR or cash digest from reports.

Out of v1: recording payments, approving (posting) invoices or bills, bank transactions, journals, payroll, voids and deletes, card charges.

**Scope note against intent.md non-goal 7.** Both apps connect at the level of the whole company file (QBO realm, Xero organisation). QBO has only one accounting scope, `com.intuit.quickbooks.accounting`, which is full read and write. Any accounting connection is therefore an **org connection** holding company-wide financial access. This is not "admin-level data access" in the Google sense, but it should be an explicit admin-only connection.

## QuickBooks Online

### 1. Summary

QuickBooks Online (QBO) is the US small-business ledger: customers and vendors, invoices and estimates, bills and expenses, payments, bank feeds, reports. It is Zapier's #1 accounting app (see 00-ranking.md). Top workflows: payment reminders for overdue invoices, estimate drafting, bill and receipt capture (`financial` in QBO), customer upkeep, AR and cash digests.

### 2. Capability table

Base URL `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`. The REST API reference lists these entities: Account, Attachable, Batch, Bill, BillPayment, Budget, ChangeDataCapture, ChangeOrder, Class, CompanyInfo, CreditMemo, CreditCardPayment, Customer, Department, Deposit, Employee, Estimate, Invoice, Item, JournalEntry, Payment, PaymentMethod, Preferences, Purchase, PurchaseOrder, RecurringTransaction, RefundReceipt, ReimburseCharge, SalesReceipt, TaxCode/TaxRate/TaxService/TaxAgency/TaxPayment, Term, TimeActivity, Transfer, Vendor, VendorCredit, and about 25 report entities (ProfitAndLoss, BalanceSheet, ARAgingSummary/Detail, APAging*, CashFlow, GeneralLedger, CustomerBalance, TransactionList, ...). A GraphQL API covers custom fields, projects, sales tax and payroll compensation.

| Resource                                                                                                           | Operation                  | API method                                                                | Proposed Mycel risk                                                     | Reaches outsiders?                                           | Notes                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Customer / Vendor                                                                                                  | read, query                | `GET /customer/{id}`, `GET /query?query=select * from Customer where ...` | `read`                                                                  | no                                                           | Metered CorePlus. Query returns at most 1,000 per page.                                                                            |
| Customer / Vendor                                                                                                  | create, update, deactivate | `POST /customer` (sparse update with `SyncToken`); `Active=false`         | `internal_reversible`                                                   | no                                                           | No hard delete for names; you set them inactive.                                                                                   |
| Estimate                                                                                                           | create, update             | `POST /estimate`                                                          | `internal_reversible`                                                   | no                                                           | **Non-posting.** `TxnStatus`: Pending, Accepted, Closed, Rejected, Converted.                                                      |
| Estimate                                                                                                           | send                       | `POST /estimate/{id}/send[?sendTo=]`                                      | `external_send`                                                         | **yes**                                                      | Sets `EmailStatus=EmailSent`, fills `DeliveryInfo`.                                                                                |
| Estimate                                                                                                           | delete                     | `POST /estimate?operation=delete`                                         | `destructive` (allowed only as the decline of Mycel's own pending item) | no                                                           |                                                                                                                                    |
| Invoice                                                                                                            | read, query, PDF           | `GET /invoice/{id}`, `/invoice/{id}/pdf`                                  | `read`                                                                  | no                                                           | `InvoiceLink` with `include=invoiceLink`.                                                                                          |
| Invoice                                                                                                            | create, update             | `POST /invoice`                                                           | **`financial`**                                                         | no                                                           | **Posts to AR and revenue.** No draft state. `EmailStatus` NotSet / NeedToSend / EmailSent; `BillEmail` is required if NeedToSend. |
| Invoice                                                                                                            | send                       | `POST /invoice/{id}/send[?sendTo=]`                                       | `external_send`                                                         | **yes**                                                      | Overwrites `BillEmail` if `sendTo` is given.                                                                                       |
| Invoice                                                                                                            | void                       | `POST /invoice?operation=void`                                            | **`destructive`**                                                       | no                                                           | Zeroes amounts and prefixes "Voided" to `PrivateNote`.                                                                             |
| Invoice                                                                                                            | delete                     | `POST /invoice?operation=delete`                                          | **`destructive`**                                                       | no                                                           | Linked transactions must be unlinked first.                                                                                        |
| PurchaseOrder                                                                                                      | create, update             | `POST /purchaseorder`                                                     | `internal_reversible`                                                   | no                                                           | Non-posting. `POStatus` Open/Closed.                                                                                               |
| PurchaseOrder                                                                                                      | send                       | `POST /purchaseorder/{id}/send[?sendTo=]`                                 | `external_send`                                                         | **yes**                                                      | `sendTo` honoured from minor version 17.                                                                                           |
| Bill, VendorCredit                                                                                                 | create, update             | `POST /bill`                                                              | **`financial`**                                                         | no                                                           | Posts to AP. The reference shows no approval state in the API **(unverified: whether QBO Advanced's bill approval is exposed)**.   |
| BillPayment, Payment, Purchase (expense), SalesReceipt, RefundReceipt, CreditMemo, Deposit, Transfer, JournalEntry | create, update             | `POST /{entity}`                                                          | **`financial`**                                                         | Payment/SalesReceipt/RefundReceipt/CreditMemo can be emailed | Recording money and ledger entries.                                                                                                |
| Any transaction                                                                                                    | void, delete               | `?operation=void` / `?operation=delete`                                   | **`destructive`**                                                       | no                                                           |                                                                                                                                    |
| Item                                                                                                               | create, update             | `POST /item`                                                              | `internal_reversible`                                                   | no                                                           |                                                                                                                                    |
| Attachable                                                                                                         | upload, link               | `POST /upload` (multipart), `POST /attachable`                            | `internal_reversible`                                                   | no                                                           | Attach a receipt or PDF to a transaction. Up to 10,000 attachments per transaction. Standalone unlinked uploads **(unverified)**.  |
| Reports                                                                                                            | run                        | `GET /reports/{ReportName}?...`                                           | `read`                                                                  | no                                                           | CorePlus metered.                                                                                                                  |
| ChangeDataCapture                                                                                                  | poll                       | `GET /cdc?entities=...&changedSince=...`                                  | `read`                                                                  | no                                                           | See Triggers.                                                                                                                      |
| Batch                                                                                                              | up to 30 operations        | `POST /batch`                                                             | the highest level among its operations                                  | —                                                            | 40 batch requests per minute per realm and app.                                                                                    |
| QuickBooks Payments                                                                                                | charge cards, ACH          | Payments API (`com.intuit.quickbooks.payment`)                            | **`financial`** (moves money)                                           | **yes**                                                      | Out of scope.                                                                                                                      |

### 3. Pending form

QBO has **no approval or draft state for invoices or bills** in the API. Its native pending forms are the **non-posting documents** (Estimate, PurchaseOrder) plus the `EmailStatus` flag.

| Would-be `external_send`                 | prepare                                                                         | approve                         | decline                                             | check                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send an estimate                         | `POST /estimate` (TxnStatus Pending, `EmailStatus=NeedToSend`)                  | `POST /estimate/{id}/send`      | delete the Mycel-made estimate (`operation=delete`) | `GET /estimate/{id}`: `EmailSent` → done (an "Emailed" webhook fires either way, so the check can't tell Mycel's send from one made in QBO); deleted → `gone`; else `waiting` |
| Send a purchase order                    | `POST /purchaseorder`                                                           | `POST /purchaseorder/{id}/send` | delete                                              | same pattern; PurchaseOrder has an "Emailed" webhook                                                                                                                          |
| Send an invoice                          | `POST /invoice` with `EmailStatus=NeedToSend` (**already posted: `financial`**) | `POST /invoice/{id}/send`       | void or delete (**`destructive`**)                  | `EmailStatus` and the Invoice "Emailed" webhook                                                                                                                               |
| Payment reminder for an existing invoice | Gmail draft (existing pending form) holding `InvoiceLink`                       | person sends in Gmail           | discard draft                                       | Gmail adapter                                                                                                                                                                 |

So under v1 rules, QBO's usable external sends are **estimates, purchase orders and Gmail-drafted reminders**. Invoices need the `financial` decision first.

### 4. Triggers

**Webhooks** (configured per app in the developer portal; separate Production and Development sets; cover every connected company):

- Entities and operations (Create / Update / Delete / Merge / Void / Emailed): Account (C,U,D,M), Bill (C,U,D), BillPayment (C,U,D,Void), Budget (C,U), Class (C,U,D,M), CreditMemo (C,U,D,Void,Emailed), Currency (C,U), Customer (C,U,D,M), Department (C,U,M), Deposit (C,U,D), Employee (C,U,D,M), **Estimate (C,U,D,Emailed)**, **Invoice (C,U,D,Void,Emailed)**, Item (C,U,D,M), JournalCode (C,U), JournalEntry (C,U,D), Payment (C,U,D,Void,Emailed), PaymentMethod (C,U,M), Preferences (U), Purchase (C,U,D,Void), PurchaseOrder (C,U,D,Emailed), RefundReceipt (C,U,D,Void,Emailed), SalesReceipt (C,U,D,Void,Emailed), TaxAgency (C,U), Term (C,U), TimeActivity (C,U,D), Transfer (C,U,D,Void), Vendor (C,U,D,M), VendorCredit (C,U,D).
- **Payload is CloudEvents 1.0** (an array): `specversion`, `id`, `source`, `type` (e.g. `qbo.invoice.updated.v1`, `qbo.customer.merged.v1`), `datacontenttype`, `time`, `intuitentityid`, `intuitaccountid` (the realm ID), optional `data` (e.g. `deletedid` on merge). **No entity fields arrive**, so every event costs a read (CorePlus). One POST can carry events for several realms.
- Migration from the old format to CloudEvents was **mandatory by 2026-05-15** (Intuit developer blog, 2025-11-12; date from a search summary, **unverified** on the page itself).
- Signature: `intuit-signature` header = base64(HMAC-SHA256(payload, verifier token)).
- Delivery: respond 200 within **3 s**. Retries at 10 s, 20 s, 30 s, 5 min, 20 min, 2 h, 4 h, 6 h, then every 6 h. "You may not receive subsequent events ... until you correctly acknowledge the first event." Events can arrive out of order. The first notification can take up to 5 minutes.

**Polling: Change Data Capture.** `GET /cdc?entities=estimate,invoice&changedSince=<ISO>`. Look-back of 30 days, at most 1,000 objects per response, full payloads, deleted entities marked `Deleted`. Not available for JournalCode, TaxAgency, TimeActivity, TaxCode, TaxRate. Intuit recommends running CDC after missed webhooks and once a day for reconciliation.

### 5. Auth

- OAuth 2.0 (`https://appcenter.intuit.com/connect/oauth2`). Scopes: `com.intuit.quickbooks.accounting` (the whole Accounting API, read and write; **no read-only variant**), `com.intuit.quickbooks.payment`, `openid profile email phone address`. GraphQL scopes include `project-management.project` and `app-foundations.custom-field-definitions[.read]`.
- Tokens: access token 3,600 s. The refresh token rolls (`x_refresh_token_expires_in` 8,640,000 s, i.e. 100 days) within a **five-year hard lifespan** (`x_refresh_token_hard_expires_in`).
- One authorization covers one company (realm). Which QBO user roles may authorize apps: **(unverified)**.
- Production keys need an approved **self-attested assessment questionnaire** and acceptance of the Terms. An Intuit App Marketplace listing is optional (Silver tier and up) and adds a security, technical and marketing review (Program Guide §2).

### 6. Limits and pricing

**API limits.**

- 500 requests per minute per realm, and 10 requests per second per realm and app.
- Batch: up to 30 payloads recommended, 40 batch requests per minute per realm and app.
- 800 requests per minute per realm and app combined across non-QBO endpoints.
- 120 s timeout; query maximum 1,000 entities.
- HTTP 429 on throttle: wait 60 s.
- Sandbox only: 40 emails per day per realm. Production email caps: docs silent.

**Intuit App Partner Program (since 2025-07-28; Guide v1.2_03.2026).**

|                                                          | Builder       | Silver    | Gold       | Platinum   |
| -------------------------------------------------------- | ------------- | --------- | ---------- | ---------- |
| Monthly program fee                                      | No charge     | US$300    | US$1,700   | US$4,500   |
| Core API credits (data-in: create and update)            | Uncapped      | Uncapped  | Uncapped   | Uncapped   |
| CorePlus API credits (data-out: reads, queries, reports) | **500,000\*** | 1 million | 10 million | 75 million |
| CorePlus price per 1,000 calls, 1M–10M                   | N/A           | US$3.50   | Included   | Included   |
| 10M–75M                                                  | N/A           | US$1.75   | US$1.40    | Included   |
| 75M+                                                     | N/A           | US$0.35   | US$0.28    | US$0.25    |
| Minimum active connections                               | —             | —         | 500        | 3,000      |

\*"Capped upper limit of 500,000 CorePlus API calls per calendar month". "For Builder Tier partners specifically, any CorePlus API calls made above the included monthly Credits will be blocked." The limits page says that beyond the cap, "an HTTP 429 error will be returned."

Further rules from the Guide:

- "The combination of the endpoint called and HTTP method used determines whether an API call is classified as Core or CorePlus."
- "Only successful API calls, specifically those returning a 2xx HTTP status code, are metered."
- "API calls and API Credits are aggregated across all production Apps in a given Workspace."
- Premium APIs need Silver or above.
- The program covers partners in the US, UK, Australia and Canada (excluding Quebec).

What this means for Mycel: the cap is **per workspace, across all customers**. Polling 100 companies every 5 minutes with three reads each is about 2.6M CorePlus calls a month, which Builder would block. So use webhooks, read on events, and run CDC once a day. Writes are free.

### 7. Nango

- `quickbooks` provider: OAuth2. `realmId` is captured from the redirect (`redirect_uri_metadata`) into the connection config. Proxy base `https://quickbooks.api.intuit.com`.
- Also `quickbooks-sandbox` (an alias) and a generic `intuit`.
- **No `webhook_routing_script`**: Mycel must host its own Intuit webhook endpoint, verify `intuit-signature`, and map `intuitaccountid` (realm) to a Nango connection.

### 8. Gaps and gotchas

- **No draft invoices or bills, and no approval states, in the API.** Most "prepare an invoice or bill" workflows are `financial` in QBO but `internal_reversible` in Xero.
- **One all-powerful accounting scope.** The catalog can't narrow the OAuth grant, so least privilege has to be enforced in Mycel's catalog.
- Updates and deletes need the current `SyncToken` (optimistic locking).
- Webhooks carry IDs only, and every follow-up read is metered CorePlus.
- **AI and data terms.** The Intuit Developer Terms of Service ("As of October 14, 2025") contain **no explicit ban on model training**, but they say:
  - §11.7 "Artificial Intelligence and Large Language Models. You shall comply with the standards imposed by the National Institute of Standards and Technology ("NIST") related to the performance of your obligations under this Agreement, including but not limited to, your use of any Artificial Intelligence ("AI"), Large Language Models ("LLMs") ... including any use by any unaffiliated third party."
  - §12.2 requires compliance with "Intuit's Data Stewardship Principles" and "Intuit's Responsible AI Principles". Data may be used "solely for the purposes of providing Users the functionality of your Developer Application". Third-party processors need written agreements "at least as restrictive", and User Data must be securely deleted on request.
  - §3.1 prohibits "Data Retrieval Activities ... scraping, automated retrieval, botting, crawling, **data mining**, harvesting, **indexing**" and "Wholesale Activities ... general archiving, back-up purposes". Both deserve legal review against Discovery-style mining.
  - Intuit's _website_ terms separately prohibit "training or developing artificial intelligence or machine learning models or related technology using information derived from the Platform without authorization". Whether that applies to API data is not stated.
- Invariant 8 fits well: CDC and webhooks give full payloads in memory only. Persist IDs and `SyncToken`, then re-fetch.

## Xero

### 1. Summary

Xero is the cloud ledger that leads in Australia, New Zealand and the UK. It reported 4.92M subscribers in FY26 and is Zapier's #2 accounting app (see 00-ranking.md). It has the **best native pending form among accounting apps**: an invoice or bill moves `DRAFT` → `SUBMITTED` ("Awaiting approval") → `AUTHORISED`, and nothing posts to the ledger before `AUTHORISED`. Top workflows: bill capture into draft bills, draft invoices for approval, overdue reminders, quote drafting, contact upkeep.

### 2. Capability table

Base URL `https://api.xero.com/api.xro/2.0/`. Every call needs the `xero-tenant-id` header.

| Resource                                           | Operation                        | API method                                                                                                                                            | Proposed Mycel risk                                                     | Reaches outsiders?     | Notes                                                                                                                               |
| -------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Contacts                                           | read                             | `GET /Contacts[/{id}]`, paged                                                                                                                         | `read`                                                                  | no                     |                                                                                                                                     |
| Contacts                                           | create, update, archive          | `PUT`/`POST /Contacts` (`ContactStatus=ARCHIVED`)                                                                                                     | `internal_reversible`                                                   | no                     | No delete. Archiving is reversible.                                                                                                 |
| Invoices (ACCREC and ACCPAY = bills)               | read                             | `GET /Invoices` with `Statuses=`, `ContactIDs=`, `where`, `If-Modified-Since`, `page`/`pageSize` (default 100), `summaryOnly`, `SearchTerm`           | `read`                                                                  | no                     |                                                                                                                                     |
| Invoices                                           | online link, PDF                 | `GET /Invoices/{id}/OnlineInvoice` (not for DRAFT); PDF via `Accept: application/pdf` **(unverified)**                                                | `read`                                                                  | no                     |                                                                                                                                     |
| Invoices                                           | create as `DRAFT` or `SUBMITTED` | `PUT`/`POST /Invoices`                                                                                                                                | `internal_reversible`                                                   | no                     | "No journals are created so the details will not be used in any reports."                                                           |
| Invoices                                           | approve (`AUTHORISED`)           | `POST /Invoices/{id}` with `Status=AUTHORISED`                                                                                                        | **`financial`**                                                         | no                     | "Journals are created ... You can now apply payments".                                                                              |
| Invoices                                           | email                            | `POST /Invoices/{id}/Email` (empty body)                                                                                                              | `external_send`                                                         | **yes**                | ACCREC only; status must be `SUBMITTED`, `AUTHORISED` or `PAID`.                                                                    |
| Invoices                                           | mark as sent                     | `SentToContact=true`                                                                                                                                  | `internal_reversible`                                                   | no                     | Only on approved invoices.                                                                                                          |
| Invoices                                           | delete `DRAFT`/`SUBMITTED`       | `Status=DELETED`                                                                                                                                      | `destructive` (allowed only as the decline of Mycel's own pending item) | no                     |                                                                                                                                     |
| Invoices                                           | void `AUTHORISED`                | `Status=VOIDED`                                                                                                                                       | **`destructive`**                                                       | no                     |                                                                                                                                     |
| Invoices                                           | history note                     | `PUT /Invoices/{id}/History`                                                                                                                          | `internal_reversible`, but **append-only**                              | no                     |                                                                                                                                     |
| Quotes                                             | create, update                   | `PUT`/`POST /Quotes`                                                                                                                                  | `internal_reversible`                                                   | no                     | Transitions: DRAFT→SENT/DELETED; SENT→ACCEPTED/DECLINED/DELETED; ACCEPTED→INVOICED. **No email endpoint**: `SENT` is only a status. |
| PurchaseOrders                                     | create, update                   | `PUT`/`POST /PurchaseOrders`                                                                                                                          | `internal_reversible` (`DRAFT`)                                         | no                     | **No email endpoint.** `SentToContact` flag only.                                                                                   |
| CreditNotes                                        | create as `DRAFT`                | `PUT /CreditNotes`                                                                                                                                    | `internal_reversible`                                                   | no                     | Moving to `AUTHORISED` or allocating it is **`financial`**.                                                                         |
| Payments, BatchPayments, Overpayments, Prepayments | create                           | `PUT /Payments` etc.                                                                                                                                  | **`financial`**                                                         | no                     | Records money. Deleting a payment is `destructive`.                                                                                 |
| BankTransactions, BankTransfers                    | create                           | `PUT /BankTransactions`                                                                                                                               | **`financial`**                                                         | no                     |                                                                                                                                     |
| ManualJournals                                     | create                           | `PUT /ManualJournals`                                                                                                                                 | **`financial`**                                                         | no                     |                                                                                                                                     |
| Items                                              | create, update / delete          | `PUT`/`POST /Items` / `DELETE /Items/{id}`                                                                                                            | `internal_reversible` / **`destructive`**                               | no                     |                                                                                                                                     |
| Attachments                                        | upload, list, download           | `PUT`/`POST /{Endpoint}/{Guid}/Attachments/{FileName}` (`IncludeOnline=true` to show on the online invoice)                                           | `internal_reversible`, but **no DELETE method in the API**              | via the online invoice | Supported on Invoices, CreditNotes, BankTransactions, Contacts, ManualJournals, PurchaseOrders, Receipts, Accounts and more.        |
| Reports                                            | run                              | `GET /Reports/AgedReceivablesByContact`, `ProfitAndLoss`, `BalanceSheet`, `BankSummary`, `TrialBalance`, `BudgetSummary`, `ExecutiveSummary`, GST/BAS | `read`                                                                  | no                     |                                                                                                                                     |
| Journals                                           | read                             | `GET /Journals`                                                                                                                                       | `read`                                                                  | no                     | **Advanced plan only** ("security assessment and use case approval").                                                               |
| ExpenseClaims, Receipts                            | —                                | deprecated                                                                                                                                            | —                                                                       | —                      | Xero: "create ACCPAY Invoices (bills) in Xero instead".                                                                             |
| Files, Assets, Projects, Payroll APIs              | various                          | separate APIs                                                                                                                                         | read / internal; payroll **`financial`**                                | —                      | Payroll is out of scope.                                                                                                            |

### 3. Pending form

| Would-be action                                                           | prepare                                                                         | approve                                                                                     | decline                      | check                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invoice for a person to approve and send** (recommended for v1)         | `PUT /Invoices` with `Status=SUBMITTED` (appears in Xero's "Awaiting approval") | **the person approves and sends it in Xero** (Mycel never posts)                            | `POST` with `Status=DELETED` | `GET /Invoices/{id}`: `DRAFT`/`SUBMITTED` → `waiting`; `AUTHORISED`/`PAID` → `done_in_app` (`SentToContact` shows whether it was sent); `DELETED`/`VOIDED` or 404 → `gone`. An Invoice UPDATE webhook triggers the check. |
| Invoice that Mycel sends on approval (later, once `financial` is allowed) | same                                                                            | `Status=AUTHORISED` (**`financial`**), then `POST /Invoices/{id}/Email`                     | same                         | same                                                                                                                                                                                                                      |
| Bill (ACCPAY) from an emailed PDF                                         | `PUT /Invoices` `Type=ACCPAY`, `DRAFT`/`SUBMITTED`, plus the attachment         | the person approves in Xero                                                                 | `Status=DELETED`             | same as above. Nothing leaves the company, so no `external_send`.                                                                                                                                                         |
| Quote                                                                     | `PUT /Quotes` `DRAFT`                                                           | none in the API. Use a Gmail draft holding the quote or link, or the person sends from Xero | `Status=DELETED`             | Quote status `SENT`/`ACCEPTED` → `done_in_app`. No webhook, so poll.                                                                                                                                                      |
| Payment reminder                                                          | Gmail draft holding the `OnlineInvoiceUrl`                                      | person sends in Gmail                                                                       | discard                      | Gmail adapter                                                                                                                                                                                                             |

Notes:

- Xero emails "will be sent to the primary email address of the contact ... The sender will be the user who authorised the app connection." So the sender identity is tied to whoever connected Xero, which matters for org connections.
- Email cap per organisation (API and app combined): 1,000 a day for paying organisations, 20 for trial organisations, 0 for demo organisations.

### 4. Triggers

**Webhooks.** Configured per app in the developer portal: one HTTPS URL, chosen categories, and the events of every connected organisation.

- Categories (each `CREATE`/`UPDATE`): **Contact, Credit Note, Invoice, Overpayment, Prepayment, Subscription** (App Store). Archiving counts as UPDATE.
- **No webhooks for Quotes, Payments, BankTransactions, PurchaseOrders or Items.** Poll these with `If-Modified-Since`.
- Whether Invoice events fire for bills (ACCPAY): the docs don't say; likely yes because bills are the same resource **(unverified)**.
- Payload: `events[]` with `resourceUrl`, `resourceId`, `eventDateUtc`, `eventType`, `eventCategory`, `tenantId`, `tenantType` (ORGANISATION or APPLICATION), plus `firstEventSequence`, `lastEventSequence`, `entropy`. Credit Note, Prepayment and Overpayment events carry a `data` object (`Type`, `Status`). Invoice events carry only the ID, so a GET follows (egress).
- Security: header `x-xero-signature` = base64(HMAC-SHA256(payload, webhook key)). The endpoint must answer 2xx within **5 s** and return 401 on a bad signature. The "Intent to receive" validation runs before any delivery.
- Failure handling: an immediate retry, then retries every 15 min for 24 h. After that the subscription is disabled and collaborators are emailed. "Any events that happen while your subscription is in the Retry or Disabled states will be saved for up to 31 days and replayed in order". Xero tells consumers to be idempotent.

**Polling.** The `If-Modified-Since` header on Invoices, Contacts and other endpoints. Pagination is supported on invoices, credit notes, contacts, bank transactions and manual journals.

### 5. Auth

- OAuth 2.0 authorization code (Web or PKCE app). Access token lasts 30 min. With `offline_access`, refresh tokens last 60 days and rotate on every use. `offline_access` is required for certification.
- One consent can connect **several organisations**. Read `GET /connections` and send `xero-tenant-id` on every call.
- **Granular scopes.** Apps created on or after 2026-03-02 use only granular scopes; broad scopes (`accounting.transactions[.read]`, `accounting.reports.read`) remain for older apps until **September 2027**. Scopes by capability group:
  - Invoices, quotes, POs, credit notes, items: `accounting.invoices` / `accounting.invoices.read`
  - Payments: `accounting.payments[.read]`
  - Bank transactions: `accounting.banktransactions[.read]`
  - Manual journals: `accounting.manualjournals[.read]`
  - Contacts: `accounting.contacts[.read]`
  - Attachments: `accounting.attachments[.read]`
  - Settings (accounts, tax rates, branding themes, users): `accounting.settings[.read]`
  - Reports: `accounting.reports.aged.read`, `.profitandloss.read`, `.balancesheet.read`, `.banksummary.read`, `.trialbalance.read`, `.budgetsummary.read`, `.executivesummary.read`, `.taxreports.read`, `.tenninetynine.read`
  - Journals: `accounting.journals.read`
  - Budgets: `accounting.budgets.read`
  - Other APIs: `files[.read]`, `assets[.read]`, `projects[.read]`, payroll scopes
  - Behind extra certification: `paymentservices`, `bankfeedsv2`, finance and accountdata scopes
- A minimal v1 set: `offline_access openid profile email accounting.contacts accounting.invoices accounting.attachments accounting.reports.aged.read accounting.settings.read accounting.payments.read`.
- **Certification** (checkpoints): a connection and settings page showing the tenant name and status, a disconnect button that calls `DELETE /connections/{id}`, handling of disconnects made from Xero's side, branding (the app name may not contain "Xero"), an App Launcher link, minimal scopes, and error handling. Certification moves the app to the Plus plan.
- Uncertified-app limits: "New apps default to the starter tier with 5 connections. Moving up to Core will give you up to 50 connections." Also, "each organisation or practice is limited to connecting a maximum of five uncertified apps."

### 6. Limits and pricing

**Rate limits, per tenant.**

- 5 concurrent requests, 60 calls a minute.
- **1,000 calls a day on Starter, 5,000 a day on Core and above.**
- App-wide: 10,000 calls a minute.
- Headers `X-DayLimit-Remaining`, `X-MinLimit-Remaining`, `X-AppMinLimit-Remaining`. A 429 response carries `X-Rate-Limit-Problem` and `Retry-After`.
- Maximum request 10 MB; batches of 50 recommended.

**Customer-plan limit.** A Xero organisation on the "Early"/Starter plan can approve only 20 AR invoices and 5 AP bills a month. Beyond that, the API returns 400 "You have reached the limit of invoices you can approve."

**Developer pricing (effective 2026-03-02; AUD, tax-exclusive).**

|                           | Starter   | Core           | Plus              | Advanced                                                    | Enterprise           |
| ------------------------- | --------- | -------------- | ----------------- | ----------------------------------------------------------- | -------------------- |
| Max connections           | 5         | 50             | 1,000             | 10,000                                                      | No limit             |
| Monthly fee               | No charge | $35            | $245              | $1,445                                                      | Price on application |
| Egress included per month | n/a       | 10 GB          | 50 GB             | 250 GB                                                      | On application       |
| Egress overage            | n/a       | $2.40/GB       | $2.40/GB          | $2.40/GB                                                    | On application       |
| Prerequisites             | —         | payment method | App Certification | Certification plus security assessment (initial and annual) | same                 |
| Xero App Store            | n/a       | n/a            | optional          | optional                                                    | required             |

More pricing details:

- Ingress is unlimited on every plan.
- Rapid Sync (limits lifted for a connection's first 30 minutes) comes with Plus and above.
- "Connection count and API data consumption via the Xero API is measured and priced at the app level."
- "Connections: customer or tenants connected to your app via a valid OAuth connection".
- "API Usage Egress: the process of extracting or downloading accounting and financial data from a connected Xero organisation to your external app".
- The organisation endpoint is excluded from egress.
- The revenue-share model (Xero App Store Subscriptions, Commercial Billing) was retired for new apps on 2025-12-04.

**Developer terms on AI and ML (Xero Developer Platform Terms & Conditions, "Last updated: 4 December 2025".** "If you registered as a Xero developer on or after 4 December 2025, these terms apply to you straight away. If you registered ... before 4 December 2025, this version of the terms applies to you from 2 March 2026."):

- Introduction: "You must not use API Data sourced from the Xero developer platform to train or fine tune any artificial intelligence models including machine learning tools, large language models or predictive analytics tools (AI Models). For the purposes of these terms, "API Data" means any information accessed, received, transmitted, or generated through use of the developer platform's public application programming interfaces (APIs), whether in raw or processed form."
- §7(b): "You may only use API Data sourced from the developer platform for the specific purpose of developing, testing, and supporting your app's features in accordance with your approved use case ... i.) Training of AI Models: API Data cannot be used to train, fine tune, adapt, or enhance any AI Models. ii.) Data passthrough: API Data shall not be passed to another third party without consent from the associated user."
- §29 also forbids anyone to "Aggregate and supply user data (or any other API Data accessed through the developer platform) to another app or any third party" and to "Use any automated tools, such as bots or browser extensions, to access or interact with Xero's systems in a way that circumvents or undermines our security controls or that simulates user actions without Xero's explicit authorisation."
- Monitoring: "We use automated monitoring and other measures ... and may conduct audits"; audits happen at most twice a year.

What this means for Mycel:

- Inference over Xero data is allowed. Training, fine-tuning or "enhancing" any model on it is not. Model-provider contracts must exclude training on prompts.
- Sending Xero data to an LLM provider is arguably a "passthrough to a third party", so get explicit user consent in the connect flow.
- "Adapt, or enhance" could reach per-org tuning such as Mycel's shadow-eval threshold tuning on Xero-derived labels. Needs legal review.

### 7. Nango

- `xero` provider: OAuth2 with `default_scopes: offline_access, openid`. Proxy base `https://api.xero.com`, retrying on `retry-after`.
- **`post_connection_script: xeroPostConnection`** fetches the tenant after connect; the multi-org case needs handling.
- **`webhook_routing_script: xeroWebhookRouting` and `webhook_user_defined_secret: true`**: Nango receives Xero's per-app webhook, verifies it with the key Mycel supplies, and routes events by `tenantId`.
- Also `xero-oauth2-cc` (client credentials, for custom connections).
- Nango's prebuilt Xero syncs: **(unverified)**.

### 8. Gaps and gotchas

- The API can email only invoices. **Quotes, POs and credit notes have no send endpoint**, so their external send goes through Gmail.
- The API can email a `SUBMITTED` (unapproved) invoice, so the catalog must not expose that combination.
- Webhooks cover only six categories, with ID-only payloads. Webhook configuration lives in the portal, not the API.
- Attachments and history notes can't be deleted through the API, so their reversal needs a person.
- The Starter plan (free, 5 connections, 1,000 calls a day per org) is fine for dogfooding. Up to 50 customers costs A$35 a month without certification. Beyond 50, certification is required.
- Xero also ships an "AI toolkit" (agent SDKs, prompts) and a remote MCP server ("Demo org only" on Starter). Not needed by Mycel, but it shows Xero allows agentic use under its terms.

## Sources

QuickBooks Online / Intuit:

- Intuit App Partner Program Guide v1.2_03.2026 (PDF): https://static.developer.intuit.com/resources/Intuit_App_Partner_Program_Guide.pdf
- Intuit launch press release, 2025-07-28: https://investors.intuit.com/_assets/_05d07b9238d83c8d2794a6ab131c7f65/intuit/news/2025-07-28_Intuit_Launches_New_App_Partner_Program_to_Drive_1261.pdf
- API call limits and throttles: https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html
- Webhooks overview: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks
- Configure webhooks (entity table, CloudEvents fields, signature): https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks (static copy: https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html)
- Webhooks data object: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/data-objects
- Webhooks best practices (retries): https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices
- Webhooks payload change blog, 2025-11-12 (redirects to Medium; deadline taken from a search summary): https://blogs.intuit.com/2025/11/12/upcoming-change-to-webhooks-payload-structure/
- Change data capture: https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture.html
- Scopes: https://static.developer.intuit.com/output_html/qbo/docs/learn/scopes.html
- OAuth 2.0 (token lifetimes): https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/oauth-2.0.html
- Invoice API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
- Estimate API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/estimate
- PurchaseOrder API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchaseorder
- Intuit Developer Terms of Service (as of 2025-10-14): https://static.developer.intuit.com/output_html/qbo/docs/legal-agreements/intuit-terms-of-service-for-intuit-developer-services.html
- Intuit website terms (AI-training clause): https://www.intuit.com/legal/terms/en-us/website/

Xero:

- Developer pricing: https://developer.xero.com/pricing
- Pricing and policy FAQ: https://developer.xero.com/faq/pricing-and-policy-updates
- Developer Platform Terms & Conditions (last updated 2025-12-04): https://developer.xero.com/xero-developer-platform-terms-conditions
- OAuth 2.0 API limits: https://developer.xero.com/documentation/guides/oauth2/limits/
- Scopes: https://developer.xero.com/documentation/guides/oauth2/scopes/
- Granular scopes FAQ: https://developer.xero.com/faq/granular-scopes
- Webhooks overview: https://developer.xero.com/documentation/guides/webhooks/overview/
- Webhooks OpenAPI: https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-webhooks.yaml
- Invoices: https://developer.xero.com/documentation/api/accounting/invoices
- Quotes: https://developer.xero.com/documentation/api/accounting/quotes
- Purchase orders: https://developer.xero.com/documentation/api/accounting/purchaseorders
- Attachments: https://developer.xero.com/documentation/api/accounting/attachments
- Expense claims (deprecated): https://developer.xero.com/documentation/api/accounting/expenseclaims
- Certification checkpoints: https://developer.xero.com/documentation/xero-app-store/app-partner-guides/certification-checkpoints

Nango:

- providers.yaml (`quickbooks`, `quickbooks-sandbox`, `intuit`, `xero`, `xero-oauth2-cc`): https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml

Mycel context: `docs/intent.md` (non-goals 1 and 7), `docs/architecture.md` "Risk policy", ADR-0013, `app/src/features/policy/catalog.ts`.
