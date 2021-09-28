import { Logger, Middleware } from '../types'

export const log: (logger: Logger) => Middleware = (logger) => () => ({
  async publish({ message, next }): Promise<void> {
    try {
      await next(message)
      logger.trace(
        `Published message ${message.headers.id} to ${message.topic}`
      )
    } catch (error) {
      logger.error(
        `Error publishing message ${message.headers.id} to ${message.topic}`,
        {
          error
        }
      )
      throw error
    }
  },

  async subscribe({ subscriber, next }): Promise<void> {
    const details = { topics: subscriber.topics, options: subscriber.options }

    try {
      await next(subscriber)

      logger.info(`Subscribed ${subscriber.name}`, details)
    } catch (error) {
      logger.error(`Failed subscribing ${subscriber.name}`, {
        ...details,
        error
      })

      throw error
    }
  },

  async handle({ message, next, subscriber }): Promise<void> {
    const start = Date.now()
    const details = {
      subscriber: subscriber.name,
      topic: message.topic,
      messageId: message.headers.id
    }
    try {
      await next(message)
      logger.trace(`Handled message for ${subscriber.name}`, {
        ...details,
        duration: Date.now() - start
      })
    } catch (error) {
      logger.error(`Error handling message for ${subscriber.name}`, {
        ...details,
        duration: Date.now() - start,
        error
      })

      throw error
    }
  }
})
