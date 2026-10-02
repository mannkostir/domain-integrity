import { Invitation, InvitationStatus } from './invitation';

export class WithStatus {
  constructor(private readonly status: InvitationStatus) {}

  mutate(invitation: Invitation): void {
    invitation.status = this.status;
  }
}
