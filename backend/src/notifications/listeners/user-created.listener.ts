import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  USER_CREATED_EVENT,
  UserCreatedEvent,
} from '../../common/events/user-created.event';
import { NotificationsService } from '../notifications.service';

/**
 * Decouples "a user registered" from "send a welcome email" — AuthModule/
 * UsersModule just emits the event and doesn't know NotificationsModule
 * exists. A failed email never fails the registration request.
 */
@Injectable()
export class UserCreatedListener {
  private readonly logger = new Logger(UserCreatedListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(USER_CREATED_EVENT)
  async handleUserCreated(event: UserCreatedEvent): Promise<void> {
    try {
      await this.notifications.sendWelcomeEmail(event.email, event.displayName);
    } catch (err) {
      this.logger.error(
        `Failed to send welcome email to ${event.email}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
