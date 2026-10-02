import { AggregateRoot } from './aggregate-root';

export type InvitationStatus = 'pending' | 'accepted' | 'rejected';

export class Invitation extends AggregateRoot<{ email: string }> {
  status: InvitationStatus = 'pending';

  static invite(email: string): Invitation {
    return new Invitation({ email });
  }
}
