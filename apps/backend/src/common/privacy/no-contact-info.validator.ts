import { registerDecorator, type ValidationOptions } from 'class-validator';
import { containsContactInfo } from './redact';

/**
 * Minimization at the input boundary (ROADMAP.md O14): free-text fields the
 * app shows to other players (display name, card description, a support
 * reason) must not become a place to store emails or phone numbers. The
 * app already has the one contact channel it needs (the account email, used
 * only by the backend); anything else typed here would be extra personal
 * data published to strangers, so it's rejected with a 400 instead of
 * stored.
 */
export function NoContactInfo(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'noContactInfo',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must not contain an email address or phone number`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || !containsContactInfo(value),
      },
    });
  };
}
