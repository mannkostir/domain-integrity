import { Invitation } from './invitation';
import { WithStatus } from './with-status';

export class InvitationService {
  accept(invitation: Invitation): void {
    invitation.status = 'accepted';
  }

  reinvite(invitation: Invitation): void {
    new WithStatus('pending').mutate(invitation);
  }
}
