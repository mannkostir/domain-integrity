import { AggregateRoot } from './aggregate-root';

class TodoRules {
  static notCompleted(completed: boolean): boolean {
    return !completed;
  }
}

export class Todo extends AggregateRoot<{ title: string; completed: boolean }> {
  private deleted = false;

  static create(title: string): Todo {
    return new Todo({ title, completed: false });
  }

  complete(): void {
    if (!TodoRules.notCompleted(this.props.completed)) throw new Error('Already completed');
    this.props.completed = true;
    this.addEvent({ type: 'TodoCompleted' });
  }

  rename(title: string): void {
    if (this.deleted) throw new Error('Deleted');
    this.props.title = title;
  }

  delete(): void {
    this.deleted = true;
    this.addEvent({ type: 'TodoDeleted' });
  }
}
