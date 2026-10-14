# Kundgranskning av offert

## Omfattning

Handlaren tillgängliggör uttryckligen en bestämd, oföränderlig offertversion. Kunden använder `/my-offers` och ett inloggat konto med verifierad e-post som matchar offertens sparade kundadress. Ingen företagsinbjudan eller medlemsroll krävs. Den generiska länken ger ingen åtkomst i sig. Inga utgående mejl, hemliga länkar, BankID-signeringar, finansbeslut eller automatisk försäljning/reservation ingår.

Kunden granskar företag, bil, totalpris, momsmodell, giltighet och villkor före ett uttryckligt accepterat eller avböjt svar. Accept är ett svar på offerten och dess villkor; det är inte en verifierad elektronisk underskrift. Köpeavtal/leverans följer separat. Oförändrat offertsnapshot och svar bevaras; återkallelse får bara ske före svar. Endast senaste offertversionen och aktiva affärer får nya svar; gammal obesvarad version visas som ersatt. Accepterat/avböjt svar fortsätter visas historiskt efter ny version. Okänd momsmodell får inte tillgängliggöras för kundaccept.

## Kontrakt mellan lager

RPC är privata implementationer med explicit grants till authenticated och invoker wrappers i public. Ingen anon/service_role-exekvering eller direkt tabellåtkomst. Aktör hämtas från faktisk auth.users med verifiering, förbud/anonymous-kontroll och delat Auth-radlås via company_team_identity(true). Handlare använder samma aktuella företags-/medlemskontroll och låsordning som CRM, sedan affärslås. Kundmutation låser Auth, företag för share, affär för update, granskningsrad för update, kontroll av senaste version och väggklockedatum efter lås. Idempotens är aktör + requestId med exakt payload och historiskt kvitto, kontrollerad efter aktuell auktorisering före rörliga datum/statuskontroller.

Review DTO (camelCase): id, companyId, dealId, offerId, offerVersion, recipientEmail, status (pending|accepted|declined|withdrawn|superseded|expired|unavailable), version (positive int), createdAt, decidedAt (nullable), responderName (nullable), reason (nullable). Status computed: saved terminal status first, else active company/deal, latest version, expiry in Stockholm, pending. Customer DTO additionally snapshot: original stored OfferSnapshot with company/customer/stock/vehicle/vat whitelist only; no internal costs/notes/member identity. Fresh server-side Auth before and after each access. Dealer DTO never exposes customer Auth UUID. Raw envelope actorUserId is removed by actions.

RPCs:

- list_deal_offer_reviews(p_company_id uuid,p_deal_id uuid): {companyId,actorUserId,actorRole,reviews,latestOffer} (latest 50 reviews, one per offer; no other deal). latestOffer null or {offerId,offerVersion,recipientEmail:string|null,validUntil,vatScheme:'standard'|'vmb'|'unknown'} comes from newest stored offer snapshot; preview before publication never uses editable/current customer fields.
- publish_offer_review(p_company_id uuid,p_deal_id uuid,p_offer_id uuid,p_request_id uuid): {companyId,actorUserId,requestId,review}. owner/admin/sales only, latest immutable version, active deal, valid Stockholm date, usable saved customer email, known standard/vmb VAT, exact nonce. One review per company/offer. Duplicate publication with different request conflicts, exact replay returns original receipt.
- withdraw_offer_review(p_company_id uuid,p_deal_id uuid,p_review_id uuid,p_expected_version int,p_reason text,p_request_id uuid): same receipt. Only pending saved status, reason trimmed2..500 singleline, CAS. Terminal answers immutable.
- list_my_offer_reviews(p_page_key uuid default null,p_limit int default50): {actorUserId,recipientEmail,reviews:[ReviewDTO+snapshot],nextPageKey}. Server actual verified normalized email; company active; paginated id DESC across all explicitly published matching emails. Cursor scoped to same email/company-active visibility.
- respond_offer_review(p_review_id uuid,p_expected_version int,p_decision text,p_responder_name text,p_reason text,p_ack_version text,p_request_id uuid): {actorUserId,requestId,review} (customer DTO). Decision accepted|declined, name trimmed2..160 singleline, accepted reason null, declined reason2..500 singleline; explicit ack_version='2026-10-14'. Persist actual actor UUID privately, normalized verified email, acknowledged version/name/decision/server timestamp in immutable audit. No payload-only caller email/actor.

TypeScript actions in src/lib/data/offer-review-actions.ts:

- listDealOfferReviewsAction({companyId,dealId})
- publishOfferReviewAction({companyId,dealId,offerId,requestId})
- withdrawOfferReviewAction({companyId,dealId,reviewId,expectedVersion,reason,requestId})
- listMyOfferReviewsAction({pageKey?})
- respondOfferReviewAction({reviewId,expectedVersion,decision,responderName,reason:string|null,ackVersion:'2026-10-14',requestId})

Return discriminated ReviewResult<T> = ({ok:true}&T)|{ok:false,code:'invalid_input'|'unauthenticated'|'access_denied'|'conflict'|'unavailable',message:string}. Shared types src/lib/offer-review/types.ts. Parsed DTOs validate scope, exact immutable IDs, status/version, optional/null values, money and complete safe snapshot. On loss of scope/UI prop change clear previously displayed personal data; late replies ignored using generation identity. Retry keeps exact nonce only for identical reviewed payload; after success reload actual state. No draft editable fields while pending; accepted/declined/withdrawn become read-only. Demo never performs actions.

## UI

DealerOfferReviews({companyId,dealId,canEdit,demo?}) separate component inside opened DealOffers panel, independent scoped loading, fetches latestOffer preview and review list through listDealOfferReviewsAction. Reviewer explicitly checks saved recipient/version/expiry before publication. Generic customer link displayed after success. Reason review before withdrawal. CustomerOfferReviews({userId}) for standalone account page: complete customer-facing terms/price/VAT, affirmative checkbox and typed name before reviewed submit, decline reason, confirm action, errors/status/history, pagination. Both keyboard/mobile readable, existing button-green/outline conventions. No regular workspace membership onboarding for /my-offers.

## Verifiering

Actual full migration-chain SQL tests with two tenants, real roles, verified/unverified customer email, foreign IDs, expiry/supersession, publish/withdraw/respond nonce/CAS, immutable receipts, minimized snapshots and pagination. Action tests fresh pre/post Auth and whitelist. Browser verifies dealer/customer transitions, retries, data clearing, read-only/demo, mobile overflow/focus. Hosted migration only after full local checks, rollback SQL proof before production publication.
