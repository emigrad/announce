import { Subscriber } from './Subscriber'

/**
 * Returns a subscriber that's modified in some way
 */
export interface SubscriberWrapper<
  WrapperArgs extends unknown[],
  Body = unknown
> {
  (subscriber: Subscriber<Body>, ...args: WrapperArgs): Subscriber
}
