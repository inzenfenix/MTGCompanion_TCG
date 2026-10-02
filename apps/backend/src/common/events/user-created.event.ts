export const USER_CREATED_EVENT = 'user.created';

export class UserCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly displayName: string,
  ) {}
}
