import { defineDomain, lifecycle } from 'domain-integrity';
import { Todo } from './src/todo';

export default defineDomain({
  lifecycles: [lifecycle(Todo, { states: { deleted: { terminal: true } } })],
});
