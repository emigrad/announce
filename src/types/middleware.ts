import { Subscriber, SubscriberExtra } from './subscriber'

export interface Middleware<
  InExtra extends SubscriberExtra = SubscriberExtra,
  OutExtra extends SubscriberExtra = InExtra
> {
  <Body extends {} | undefined>(subscriber: Subscriber<Body, OutExtra>): (
    body: Body,
    extra: InExtra,
    next: NextFunction<Body, OutExtra>
  ) => any | Promise<any>
}

export interface NextFunction<
  T extends {} | undefined,
  Extra extends SubscriberExtra
> {
  (body: T, extra: Extra): any | Promise<any>
}
