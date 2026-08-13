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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
    throw new ApiError(res.status, message, body);
  }

  // DELETE and some 204s have no body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Users ───────────────────────────────────────────────────────────────
// No /login endpoint exists yet (see backend/README.md) — these are the only
// two user operations available this phase. See src/lib/auth/AuthContext.tsx
// for how they're used to fake a session.

export type UserSettings = {
  language: string;
  theme: string;
  twoFactorEnabled: boolean;
  notifyByEmail: boolean;
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
  scryfallId: string | null;
  setName: string | null;
  rarity: string | null;
  oracleText: string | null;
  createdAt: string;
  updatedAt: string;
  photos: CardPhoto[];
};

export type CreateCardInput = {
  ownerId: string;
  title: string;
  description?: string;
  guessedPrice: number;
  condition?: CardCondition;
  scryfallId?: string;
  setName?: string;
  rarity?: string;
  oracleText?: string;
};

export type UpdateCardInput = Partial<Omit<CreateCardInput, 'ownerId'>>;

export function createCard(input: CreateCardInput): Promise<Card> {
  return request<Card>('/cards', { method: 'POST', body: JSON.stringify(input) });
}

export function listCards(ownerId: string): Promise<Card[]> {
  return request<Card[]>(`/cards?ownerId=${encodeURIComponent(ownerId)}`);
}

export function getCard(id: string): Promise<Card> {
  return request<Card>(`/cards/${id}`);
}

export function updateCard(id: string, input: UpdateCardInput): Promise<Card> {
  return request<Card>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
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

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type Transaction = {
  id: string;
  cardId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: TransactionStatus;
  paymentProvider: string | null;
  paymentRef: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTransactionInput = {
  cardId: string;
  buyerId: string;
};

export function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  return request<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export function listTransactions(userId: string): Promise<Transaction[]> {
  return request<Transaction[]>(`/transactions?userId=${encodeURIComponent(userId)}`);
}

export function getTransaction(id: string): Promise<Transaction> {
  return request<Transaction>(`/transactions/${id}`);
}
