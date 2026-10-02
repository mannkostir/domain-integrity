export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  private events: object[] = [];

  constructor(props: P) {
    this.props = props;
  }

  protected addEvent(event: object): void {
    this.events.push(event);
  }
}
