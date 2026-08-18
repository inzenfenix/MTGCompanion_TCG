/**
 * Thin typed fetch client for the MTG Companion backend (`backend/`, NestJS +
 * Prisma + PostgreSQL — see backend/README.md for the full API surface).
 *
 * Deliberately not axios/react-query: the backend surface is small (users,
 * cards, transactions) and this is a course project, so a handful of typed
 * fetch wrappers keeps the dependency graph flat. If the surface grows,
 * react-query is the natural next step for caching/retries.
 */

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Module-level token store rather than passing it around: api.ts is a plain
// module (no React), so AuthContext calls setAuthToken()/clearAuthToken()
// after login/logout and every request() call here just reads the current
// value. onUnauthorized lets AuthContext react to a 401 (expired/invalid
// token — JWT_ACCESS_TTL is 15min by default) by clearing the session,
// without api.ts needing to know anything about React state.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });

  // Nest's ValidationPipe/HttpExceptions return { statusCode, message, error }
  // — try to surface that message, fall back to statusText if the body isn't JSON.
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* empty/non-JSON error body — fall back to statusText below */
    }
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : null) ?? res.statusText;

    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, message, body);
  }

  // DELETE and some 204s have no body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth / Users ────────────────────────────────────────────────────────
// See src/lib/auth/AuthContext.tsx for how these back the session — it's
// the only thing in the app that calls setAuthToken()/setUnauthorizedHandler().

export type LoginInput = { email: string; password: string };
export type LoginResult = { accessToken: string; user: User };

export function login(input: LoginInput): Promise<LoginResult> {
  return request<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type UserSettings = {
  language: string;
  theme: string;
  twoFactorEnabled: boolean;
  notifyByEmail: boolean;
  shareLocation: boolean;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  settings: UserSettings;
};

export type RegisterUserInput = {
  email: string;
  password: string;
  displayName: string;
  language?: string;
};

export function registerUser(input: RegisterUserInput): Promise<User> {
  return request<User>('/users/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getUser(id: string): Promise<User> {
  return request<User>(`/users/${id}`);
}

// ── Cards ───────────────────────────────────────────────────────────────

export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

// VAULT = a permanent collection entry (the only thing that existed before
// ROADMAP.md J1/J3). SCAN_LISTING = created purely to generate a sell QR
// from Smart Scan — still a real Card row (Transaction.cardId needs one),
// but Tab3.tsx's Vault view filters these out.
export type CardOrigin = 'VAULT' | 'SCAN_LISTING';

export type CardPhoto = {
  id: string;
  cardId: string;
  storageKey: string;
  isPrimary: boolean;
  createdAt: string;
};

export type Card = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  guessedPrice: number;
  condition: CardCondition;
  origin: CardOrigin;
  scryfallId: string | null;
  setName: string | null;
  rarity: string | null;
  oracleText: string | null;
  /** Auction state (J12) — both null = not currently up for bidding. */
  closesAt: string | null;
  wonOfferId: string | null;
  createdAt: string;
  updatedAt: string;
  photos: CardPhoto[];
};

// No ownerId here — the backend derives it from the JWT now (see
// backend/README.md "Estado actual"). Sending one would 400: the
// ValidationPipe rejects unknown body properties.
export type CreateCardInput = {
  title: string;
  description?: string;
  guessedPrice: number;
  condition?: CardCondition;
  /** Omitted = VAULT (backend default). Pass 'SCAN_LISTING' for a scan meant only to generate a sell QR (J1/J3). */
  origin?: CardOrigin;
  scryfallId?: string;
  setName?: string;
  rarity?: string;
  oracleText?: string;
};

export type UpdateCardInput = Partial<CreateCardInput>;

export function createCard(input: CreateCardInput): Promise<Card> {
  return request<Card>('/cards', { method: 'POST', body: JSON.stringify(input) });
}

// origin omitted = every card regardless of origin. Tab3.tsx's Vault view
// passes 'VAULT' so scan-to-sell listings don't clutter the collection.
export function listCards(ownerId: string, origin?: CardOrigin): Promise<Card[]> {
  const qs = new URLSearchParams({ ownerId });
  if (origin) qs.set('origin', origin);
  return request<Card[]>(`/cards?${qs.toString()}`);
}

// ── Offers / auction (J12, ROADMAP.md) ────────────────────────────────────

export type Offer = {
  id: string;
  cardId: string;
  bidderId: string;
  amount: number;
  createdAt: string;
};

export type AuctionState = {
  cardId: string;
  offers: Offer[];
  currentOffer: Offer | null;
  closesAt: string | null;
  wonOfferId: string | null;
};

export function placeOffer(cardId: string, amount: number): Promise<{ offer: Offer; closesAt: string }> {
  return request<{ offer: Offer; closesAt: string }>(`/cards/${encodeURIComponent(cardId)}/offers`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export function getAuctionState(cardId: string): Promise<AuctionState> {
  return request<AuctionState>(`/cards/${encodeURIComponent(cardId)}/offers`);
}

// ── Bazaar search (E6/F6, ROADMAP.md) ─────────────────────────────────────
// Two backend resources feed the Bazaar: the real ~58k-row Scryfall catalog
// (searchCatalog, always available, works even for cards nobody owns yet)
// and real live listings across every user's Vault (searchCardListings,
// GET /cards' global-search mode — see cards.controller.ts).

export type CardListing = Card & {
  ownerDisplayName: string;
  /** null when either side hasn't shared a location, or the searcher didn't pass lat/lng — never faked. */
  distanceKm: number | null;
};

export type SearchListingsParams = {
  q?: string;
  scryfallId?: string;
  excludeOwnerId?: string;
  lat?: number;
  lng?: number;
  limit?: number;
};

export function searchCardListings(
  params: SearchListingsParams,
): Promise<CardListing[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.scryfallId) qs.set('scryfallId', params.scryfallId);
  if (params.excludeOwnerId) qs.set('excludeOwnerId', params.excludeOwnerId);
  if (params.lat !== undefined) qs.set('lat', String(params.lat));
  if (params.lng !== undefined) qs.set('lng', String(params.lng));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  return request<CardListing[]>(`/cards?${qs.toString()}`);
}

export type CatalogEntry = {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  rarity: string | null;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colors: string[];
  oracleText: string | null;
  imageUrl: string | null;
  edhrecRank: number | null;
  // Added for ROADMAP.md E3b — Stage 3's client-side tabular feature
  // builder (priceFeatures.ts) needs these; see backend's CatalogCardEntity.
  setType: string | null;
  frame: string | null;
  borderColor: string | null;
  colorIdentity: string[];
  finishes: string[];
  frameEffects: string[];
  releasedAt: string | null;
};

export function searchCatalog(q: string, limit = 10): Promise<CatalogEntry[]> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return request<CatalogEntry[]>(`/catalog/search?${qs.toString()}`);
}

/**
 * ROADMAP.md I19/I25 — the other half of `identifyCard.ts`'s combined
 * title+rules-text identify flow: fuzzy search against `oracleText` instead
 * of `name`, so a good rules-text OCR read can still find the right card
 * when the title-bar crop didn't. Backend enforces its own 10-char minimum
 * (`catalog.service.ts`), shorter than `searchCatalog`'s 2-char one.
 */
export function searchCatalogByText(q: string, limit = 10): Promise<CatalogEntry[]> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return request<CatalogEntry[]>(`/catalog/search-by-text?${qs.toString()}`);
}

// Sending this at all is the consent — see users.controller.ts's doc
// comment. Only called after the browser's own geolocation permission
// prompt has already succeeded.
export function updateMyLocation(lat: number, lng: number): Promise<User> {
  return request<User>('/users/me/location', {
    method: 'PATCH',
    body: JSON.stringify({ lat, lng }),
  });
}

export function getCard(id: string): Promise<Card> {
  return request<Card>(`/cards/${id}`);
}

export function updateCard(id: string, input: UpdateCardInput): Promise<Card> {
  return request<Card>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// ── Listing tokens (J4, ROADMAP.md) — the signed QR payload ───────────────

/** Seller-only — mints the token Tab2.tsx's QR encodes. */
export function createListingToken(cardId: string): Promise<{ token: string; expiresIn: string }> {
  return request<{ token: string; expiresIn: string }>(`/cards/${encodeURIComponent(cardId)}/listing-token`, {
    method: 'POST',
  });
}

/** Public — Buy.tsx resolves a scanned token into a real cardId before rendering anything. */
export function resolveListingToken(token: string): Promise<{ cardId: string }> {
  return request<{ cardId: string }>(`/cards/listing-token/${encodeURIComponent(token)}`);
}

export function deleteCard(id: string): Promise<void> {
  return request<void>(`/cards/${id}`, { method: 'DELETE' });
}

// Two-step photo upload: (1) ask the backend for a presigned S3/MinIO PUT
// URL, (2) PUT the raw bytes straight to storage (no backend in the
// middle), (3) tell the backend the upload succeeded so it records the
// CardPhoto row. See backend/README.md's cards module notes.

export type UploadUrlResponse = { key: string; uploadUrl: string };

export function createPhotoUploadUrl(
  cardId: string,
  filename: string,
  contentType: string,
): Promise<UploadUrlResponse> {
  return request<UploadUrlResponse>(`/cards/${cardId}/photos/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  });
}

export async function putPhotoBytes(uploadUrl: string, blob: Blob, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Failed to upload photo bytes: ${res.statusText}`, null);
  }
}

export function confirmCardPhoto(
  cardId: string,
  storageKey: string,
  isPrimary?: boolean,
): Promise<CardPhoto> {
  return request<CardPhoto>(`/cards/${cardId}/photos`, {
    method: 'POST',
    body: JSON.stringify({ storageKey, isPrimary }),
  });
}

export function getCardPhotoUrl(photoId: string): Promise<{ url: string }> {
  return request<{ url: string }>(`/cards/photos/${photoId}/url`);
}

/**
 * Convenience wrapper around the three-call photo flow above — used by
 * ListCard.tsx so the page itself doesn't have to orchestrate upload-url →
 * PUT → confirm by hand.
 */
export async function uploadCardPhoto(
  cardId: string,
  blob: Blob,
  filename: string,
  contentType: string,
  isPrimary = true,
): Promise<CardPhoto> {
  const { key, uploadUrl } = await createPhotoUploadUrl(cardId, filename, contentType);
  await putPhotoBytes(uploadUrl, blob, contentType);
  return confirmCardPhoto(cardId, key, isPrimary);
}

// ── Transactions ────────────────────────────────────────────────────────
// No price-estimation endpoint exists anywhere yet (Stage 3 of the ML
// pipeline is still a local Python script) — `amount` here always comes
// from the card's stored `guessedPrice` at creation time, derived
// server-side, never sent by the client.

// Matches backend/prisma/schema.prisma's TransactionStatus enum exactly —
// 'PAID', not 'COMPLETED' (verified against generated/prisma/index.d.ts).
export type TransactionStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';

// MERCADOPAGO = real Checkout Pro redirect, settles async via webhook once
// configured (falls back to staying PENDING when the backend has no
// MERCADOPAGO_ACCESS_TOKEN — see ROADMAP.md F2). CASH ("Efectivo") settles
// PAID immediately, no external rail — also the fast no-credentials path.
export type PaymentMethod = 'MERCADOPAGO' | 'CASH';

export type Transaction = {
  id: string;
  cardId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: string | null;
  paymentRef: string | null;
  createdAt: string;
  updatedAt: string;
};

// No buyerId here — same reasoning as CreateCardInput.ownerId: derived from
// the JWT, sending one would 400. paymentMethod defaults to MERCADOPAGO on
// the backend when omitted.
export type CreateTransactionInput = {
  cardId: string;
  paymentMethod?: PaymentMethod;
};

// checkoutUrl is surfaced once, at creation time only (not persisted, not
// present on GET /transactions/:id) — where to send the buyer for a
// redirect-based checkout (MercadoPago Checkout Pro).
export type CreateTransactionResult = Transaction & { checkoutUrl?: string };

export function createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
  return request<CreateTransactionResult>('/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listTransactions(userId: string): Promise<Transaction[]> {
  return request<Transaction[]>(`/transactions?userId=${encodeURIComponent(userId)}`);
}

export function getTransaction(id: string): Promise<Transaction> {
  return request<Transaction>(`/transactions/${id}`);
}

// Internal itemized receipt (19% Chilean IVA breakdown) — only issuable
// once a transaction is PAID (backend 400s otherwise). NOT a real
// SII-authorized "boleta electrónica" — see the disclaimer field, always
// rendered alongside the numbers rather than dropped on the floor.
export type ReceiptBreakdown = {
  transactionId: string;
  issuedAt: string;
  item: string;
  paymentMethod: PaymentMethod;
  ivaRate: number;
  net: number;
  iva: number;
  total: number;
  disclaimer: string;
};

export function getTransactionReceipt(id: string): Promise<ReceiptBreakdown> {
  return request<ReceiptBreakdown>(`/transactions/${id}/receipt`);
}

// ROADMAP.md J6/J7 — seller-only, flips a PENDING cash transaction to PAID.
export function confirmCashReceived(id: string): Promise<Transaction> {
  return request<Transaction>(`/transactions/${id}/confirm-cash-received`, { method: 'POST' });
}
