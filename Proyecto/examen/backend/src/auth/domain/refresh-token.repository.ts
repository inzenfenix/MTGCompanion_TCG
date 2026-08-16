export interface RefreshTokenEntity {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateRefreshTokenData {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface RefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshTokenEntity>;
  findByHash(tokenHash: string): Promise<RefreshTokenEntity | null>;
  deleteById(id: string): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
