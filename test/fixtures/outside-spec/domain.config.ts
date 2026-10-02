import { defineDomain, lifecycle } from 'domain-integrity';
import { Invitation } from './src/invitation';

export default defineDomain({
  lifecycles: [lifecycle(Invitation, { states: { status: { terminal: ['accepted', 'rejected'] } } })],
});
