import { Logger, Message, Middleware } from '../types'
import { spy } from './spy'

const START_HEADER = 'x-log-start'

export const log: (logger: Logger) => Middleware = (logger) => {
  return spy({
    onPublish({ message }) {
      logger.info({
        messageId: message.properties.id,
        msg: `Published message ${message.properties.id} to ${message.topic}`
      })
    },

    onPublishError({ message, error }) {
      logger.error({
        messageId: message.properties.id,
        err: error,
        msg: `Error publishing message ${message.properties.id} to ${message.topic}`
      })
    },

    onSubscribe({ subscriber }) {
      logger.info({
        msg: `Subscribed ${subscriber.name}`,
        topics: subscriber.topics,
        name: subscriber.name
      })
    },

    onSubscribeError({ error, subscriber }) {
      logger.error({
        topics: subscriber.topics,
        name: subscriber.name,
        msg: `Failed subscribing ${subscriber.name}`,
        err: error
      })
    },

    beforeHandle({ message }) {
      message.headers[START_HEADER] = new Date().toISOString()
    },

    onHandle({ message, subscriber }) {
      logger.info({
        messageId: message.properties.id,
        duration: getDuration(message),
        topic: message.topic,
        msg: `Handled message for ${subscriber.name}`
      })
    },

    onHandleError({ error, message, subscriber }) {
      logger.error({
        messageId: message.properties.id,
        duration: getDuration(message),
        topic: message.topic,
        err: error,
        msg: `Error handling message for ${subscriber.name}: ${error}`
      })
    }
  })
}

function getDuration(message: Message<any>): number {
  return Date.now() - +new Date(message.headers[START_HEADER])
}
