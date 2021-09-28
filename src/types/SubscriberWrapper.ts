import { Subscriber } from './Subscriber'

/**
 * Returns a subscriber that's modified in some way
 */
export interface SubscriberWrapper<
  WrapperArgs extends any[],
  Body extends any
> {
  (subscriber: Subscriber<any>, ...args: WrapperArgs): Subscriber<any>
}
