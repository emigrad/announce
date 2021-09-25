import {
  HandleMiddlewareArgs,
  Middleware,
  PublishMiddlewareArgs,
  SubscribeMiddlewareArgs
} from '../types'

/**
 * Matches the interface of most loggers such as Winston and Pino
 */
export interface Logger {
  trace: (message: string, details?: any) => any
  info: (message: string, details?: any) => any
  error: (message: string, details?: any) => any
}

export class LoggerMiddleware implements Middleware {
  constructor(private readonly logger: Logger) {}

  async publish({ message, next }: PublishMiddlewareArgs): Promise<void> {
    try {
      await next(message)
      this.logger.trace(`Published message to ${message.topic}`)
    } catch (error) {
      this.logger.error(`Error publishing message to ${message.topic}`, {
        error
      })
      throw error
    }
  }

  async subscribe({
    subscriber,
    next
  }: SubscribeMiddlewareArgs): Promise<void> {
    const details = { topics: subscriber.topics, options: subscriber.options }

    try {
      await next(subscriber)

      this.logger.info(`Subscribed ${subscriber.name}`, details)
    } catch (error) {
      this.logger.error(`Failed subscribing ${subscriber.name}`, {
        ...details,
        error
      })

      throw error
    }
  }

  async handle({
    message,
    next,
    subscriber
  }: HandleMiddlewareArgs): Promise<void> {
    const start = Date.now()
    try {
      await next(message)
      this.logger.trace(`Handled message for ${subscriber.name}`, {
        subscriber: subscriber.name,
        topic: message.topic,
        duration: Date.now() - start
      })
    } catch (error) {
      this.logger.error(`Error handling message for ${subscriber.name}`, {
        subscriber: subscriber.name,
        topic: message.topic,
        duration: Date.now() - start,
        error
      })

      throw error
    }
  }
}
