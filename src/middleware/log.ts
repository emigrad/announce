import { Message, Middleware } from '../types'
import { spy } from './spy'

const START_HEADER = 'x-log-start'

export interface LogArgs<Logger> {
  /**
   * The logger instance to log to. Pino, Bunyan and Winston are all supported
   */
  logger: Logger

  /**
   * The key to place the message in. Defaults to "msg", which is correct for
   * Pino and Bunyan. For Winston it's recommended (but not required) that
   * this is set to "message"
   */
  messageKey?: string

  /**
   * Specifies which level to log each event at.
   */
  logLevels?: Partial<LogLevels<Logger>>
}

/**
 * A function on the logger that can be called to log an event
 */
export interface LogFunction {
  (details: Record<string, unknown>): unknown
}

type LogFunctions<Logger> = {
  [K in keyof Logger as Logger[K] extends LogFunction ? K : never]: Logger[K]
}

/**
 * A log level supported by the logger. For most loggers it will be
 * something similar to "trace" | "debug" | "info" | "warn" | "error"
 */
export type LogLevel<Logger> = keyof LogFunctions<Logger>

/**
 * A complete specification of which level to log each event at
 */
export type LogLevels<Logger> = Record<LoggableEvent, LogLevel<Logger>>

/**
 * The events that can be logged
 */
export type LoggableEvent =
  | 'publishSuccess'
  | 'publishError'
  | 'subscribeSuccess'
  | 'subscribeError'
  | 'handleSuccess'
  | 'handleError'

export const DEFAULT_LOG_LEVELS = {
  publishSuccess: 'debug',
  publishError: 'error',
  subscribeSuccess: 'info',
  subscribeError: 'error',
  handleSuccess: 'debug',
  handleError: 'error'
}

export const log: <Logger>(args: LogArgs<Logger>) => Middleware = <Logger>({
  logger,
  messageKey = 'msg',
  logLevels
}: LogArgs<Logger>) => {
  const fullLogLevels = {
    ...DEFAULT_LOG_LEVELS,
    ...logLevels
  } as LogLevels<Logger>
  const typedLogger = logger as unknown as Record<
    keyof LogFunctions<Logger>,
    LogFunction
  >

  return spy({
    onPublish({ message }) {
      typedLogger[fullLogLevels.publishSuccess]({
        messageId: message.properties.id,
        [messageKey]: `Published message ${message.properties.id} to ${message.topic}`
      })
    },

    onPublishError({ message, error }) {
      typedLogger[fullLogLevels.publishError]({
        messageId: message.properties.id,
        err: error,
        [messageKey]: `Error publishing message ${message.properties.id} to ${message.topic}`
      })
    },

    onSubscribe({ subscriber }) {
      typedLogger[fullLogLevels.subscribeSuccess]({
        [messageKey]: `Subscribed ${subscriber.queueName}`,
        queueName: subscriber.queueName,
        topics: subscriber.topics,
        name: subscriber.queueName
      })
    },

    onSubscribeError({ error, subscriber }) {
      typedLogger[fullLogLevels.subscribeError]({
        topics: subscriber.topics,
        queueName: subscriber.queueName,
        [messageKey]: `Failed subscribing ${subscriber.queueName}: ${error}`,
        err: error
      })
    },

    beforeHandle({ message }) {
      message.headers[START_HEADER] = new Date().toISOString()
    },

    onHandle({ message, subscriber }) {
      typedLogger[fullLogLevels.handleSuccess]({
        messageId: message.properties.id,
        duration: getDuration(message),
        topic: message.topic,
        [messageKey]: `Handled message for ${subscriber.queueName}`
      })
    },

    onHandleError({ error, message, subscriber }) {
      typedLogger[fullLogLevels.handleError]({
        messageId: message.properties.id,
        duration: getDuration(message),
        topic: message.topic,
        err: error,
        [messageKey]: `Error handling message for ${subscriber.queueName}: ${error}`
      })
    }
  })
}

function getDuration(message: Message): number {
  return Date.now() - +new Date(message.headers[START_HEADER])
}
