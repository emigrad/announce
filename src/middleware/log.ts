import { Logger, Middleware } from '../types'

export const log: (logger: Logger) => Middleware = (logger) => () => ({
  async publish({ message, next }): Promise<void> {
    try {
      await next(message)
      logger.trace({
        msg: `Published message ${message.headers.id} to ${message.topic}`
      })
    } catch (err) {
      logger.error({
        err,
        msg: `Error publishing message ${message.headers.id} to ${message.topic}`
      })

      throw err
    }
  },

  async subscribe({ subscriber, next }): Promise<void> {
    const details = { topics: subscriber.topics, options: subscriber.options }

    try {
      await next(subscriber)

      logger.info({ ...details, msg: `Subscribed ${subscriber.name}` })
    } catch (error) {
      logger.error({ ...details, msg: `Failed subscribing ${subscriber.name}` })

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
      logger.trace({
        ...details,
        msg: `Handled message for ${subscriber.name}`
      })
    } catch (err) {
      logger.error({
        ...details,
        err,
        duration: Date.now() - start,
        msg: `Error handling message for ${subscriber.name}`
      })

      throw err
    }
  }
})
