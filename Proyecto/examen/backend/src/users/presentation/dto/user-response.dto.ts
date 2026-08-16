/** What the API returns for a user — never passwordHash or twoFactorSecret. */
export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  settings: {
    language: string;
    theme: string;
    twoFactorEnabled: boolean;
    notifyByEmail: boolean;
    shareLocation: boolean;
  };
}
