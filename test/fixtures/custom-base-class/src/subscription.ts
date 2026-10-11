import { Model } from './model';

type SubscriptionProps = { state: 'active' | 'cancelled'; plan: string };

export class Subscription extends Model<SubscriptionProps> {
  static start(plan: string): Subscription {
    return new Subscription({ state: 'active', plan });
  }

  cancel(): void {
    if (this.props.state === 'cancelled') throw new Error('Subscription is already cancelled');
    this.props.state = 'cancelled';
  }

  changePlan(plan: string): void {
    this.props.plan = plan;
  }
}
