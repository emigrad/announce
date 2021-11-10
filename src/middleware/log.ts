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
        msg: `Subscribed ${subscriber.queueName}`,
        queueName: subscriber.queueName,
        topics: subscriber.topics,
        name: subscriber.queueName
      })
    },

    onSubscribeError({ error, subscriber }) {
      logger.error({
        topics: subscriber.topics,
        queueName: subscriber.queueName,
        msg: `Failed subscribing ${subscriber.queueName}: ${error}`,
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
        msg: `Handled message for ${subscriber.queueName}`
      })
    },

    onHandleError({ error, message, subscriber }) {
      logger.error({
        messageId: message.properties.id,
        duration: getDuration(message),
        topic: message.topic,
        err: error,
        msg: `Error handling message for ${subscriber.queueName}: ${error}`
      })
    }
  })
}

function getDuration(message: Message<any>): number {
  return Date.now() - +new Date(message.headers[START_HEADER])
}
