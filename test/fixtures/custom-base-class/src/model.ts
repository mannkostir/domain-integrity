export abstract class Model<P extends object = object> {
  protected props: P;

  constructor(props: P) {
    this.props = props;
  }
}
