import { Channel, ConfirmChannel, connect, Connection } from 'amqplib'
import { ConsumeMessage, Options } from 'amqplib/properties'
import cuid from 'cuid'
import { EventEmitter } from 'events'
import {
  getConcurrency,
  getDeadLetterQueueName,
  getDeadLetterTopic,
  getHeader,
  hasDeadLetterTopic
} from '../util'
import { Backend, BackendSubscriber, Message, Subscriber } from '../types'

const dateHeader = 'x-announce-date'

export interface RabbitMQOptions {
  exchange?: string
}

/**
 * A production ready backend that uses RabbitMQ
 *
 * Supports:
 *  - guaranteed delivery
 *  - dead letter queues
 *  - inter-service messaging
 *  - multiple instances
 */
export class RabbitMQBackend extends EventEmitter implements Backend {
  private readonly exchange: string
  private readonly subscribers: BackendSubscriber[]
  private readonly subscriberChannels: Record<number, PromiseLike<Channel>>
  private readonly rebuildPromises: Record<number, PromiseLike<any>>
  private connection: PromiseLike<Connection>
  private publishChannel: PromiseLike<ConfirmChannel> | undefined
  private closePromise: Promise<void> | undefined

  static accepts(url: string) {
    return /^amqps?:\/\//.test(url)
  }

  constructor(url: string, { exchange = 'events' }: RabbitMQOptions = {}) {
    super()

    this.connection = connect(url)
    this.exchange = exchange
    this.subscribers = []
    this.subscriberChannels = {}
    this.rebuildPromises = {}

    this.on('error', () => this.close())
    this.connection.then(
      (connection) => {
        connection.on('error', (err) => this.emit('error', err))
      },
      (err) => this.emit('error', err)
    )
  }

  async publish(message: Message<Buffer>): Promise<void> {
    const publishChannel = await this.getPublishChannel()
    const messageId = message.properties.id
    const timestamp = Math.floor(+message.properties.date / 1000)

    return new Promise((resolve, reject) => {
      publishChannel.publish(
        this.exchange,
        message.topic,
        message.body,
        {
          headers: {
            [dateHeader]: message.properties.date.toISOString(),
            ...message.headers
          },
          timestamp,
          messageId,
          contentType: getHeader(message, 'content-type'),
          contentEncoding: getHeader(message, 'content-encoding'),
          persistent: true
        },
        (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        }
      )
    })
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    this.subscribers.push(subscriber)

    await this.createQueue(subscriber)
    await this.consume(subscriber)
  }

  async close(): Promise<void> {
    if (!this.closePromise) {
      const connectionPromise = this.connection

      // Prevent any attempts to publish messages or add subscribers
      this.connection = Promise.reject('Connection has been closed')
      // Avoid Node complaining about unhanded rejections
      this.connection.then(null, () => {})

      Object.keys(this.subscriberChannels).map(
        (key) => delete this.subscriberChannels[key as any]
      )

      this.closePromise = (async () => {
        try {
          const connection = await connectionPromise
          await connection.close()
        } catch (e) {
          // Squelch - we are closing anyway
        }
      })()
    }

    return this.closePromise
  }

  private async getPublishChannel(): Promise<ConfirmChannel> {
    if (!this.publishChannel) {
      const connection = await this.connection
      this.publishChannel = connection.createConfirmChannel()

      // We cannot publish to exchanges that don't exist, so ensure the
      // exchange exists
      const publishChannel = await this.publishChannel
      await this.createExchange(publishChannel)
    }

    return this.publishChannel
  }

  /**
   * Rebuilds the channel with the given concurrency
   */
  private rebuildChannel(concurrency: number) {
    if (this.rebuildPromises[concurrency]) {
      return
    }

    this.rebuildPromises[concurrency] = (async () => {
      if (this.closePromise) {
        return
      }

      try {
        const channel = await this.getChannelForConcurrency(concurrency)
        await channel.close()
      } catch (e) {
        // Squelch, the channel was probably already closed
      }

      // Delete the channel promise so it gets recreated
      delete this.subscriberChannels[concurrency]

      try {
        // Note that we don't attempt to redefine the queues; if they're
        // deleted then this will fail. Also it doesn't matter if a new
        // subscriber is added between us deleting the channel and recreating
        // it - we'll just use the channel that add operation created instead
        // of creating our own
        await Promise.all(
          this.getSubscribersWithConcurrency(concurrency).map((subscriber) =>
            this.consume(subscriber)
          )
        )

        delete this.rebuildPromises[concurrency]
      } catch (err) {
        // Rebuilding failed, shut down
        this.emit('error', err)
      }
    })()
  }

  private async createExchange(channel: Channel): Promise<void> {
    await channel.assertExchange(this.exchange, 'topic')
  }

  private async createQueue(subscriber: Subscriber<Buffer>): Promise<void> {
    const channel = await this.getChannelForSubscriber(subscriber)
    const options = this.getQueueOptions(subscriber)

    await this.createExchange(channel)
    await channel.assertQueue(subscriber.queueName, options)

    if (hasDeadLetterTopic(subscriber)) {
      const deadLetterQueue = getDeadLetterQueueName(subscriber)!
      const deadLetterTopic = getDeadLetterTopic(subscriber)!

      await channel.assertQueue(deadLetterQueue, { durable: true })
      await channel.bindQueue(deadLetterQueue, this.exchange, deadLetterTopic)
    }

    await Promise.all(
      subscriber.topics.map((topic) =>
        channel.bindQueue(
          subscriber.queueName,
          this.exchange,
          topic.replace(/\*/g, '#')
        )
      )
    )
  }

  private async consume(subscriber: BackendSubscriber): Promise<void> {
    const channel = await this.getChannelForSubscriber(subscriber)

    await channel.consume(subscriber.queueName, async (message) => {
      if (!message) {
        // Notification that something interesting has happened on the
        // channel, eg a queue has been deleted. We don't know what
        // the event was, so all we can do is build a new channel
        this.rebuildChannel(getConcurrency(subscriber))
      } else {
        let ack: boolean

        try {
          await subscriber.handle(convertMessage(message))
          ack = true
        } catch (e) {
          ack = false
        }

        try {
          if (ack) {
            channel.ack(message)
          } else {
            channel.nack(message, false, false)
          }
        } catch (e) {
          // Ignore errors when attempting to ack/nack the message since
          // we already handle channel failures elsewhere
        }
      }
    })
  }

  private async getChannelForSubscriber(
    subscriber: Subscriber<Buffer>
  ): Promise<Channel> {
    return this.getChannelForConcurrency(getConcurrency(subscriber))
  }

  private async getChannelForConcurrency(
    concurrency: number
  ): Promise<Channel> {
    if (!this.subscriberChannels[concurrency]) {
      this.subscriberChannels[concurrency] = this.connection.then(
        async (connection) => {
          const channel = await connection.createChannel()
          channel.on('error', (err) => this.emit('error', err))
          await channel.prefetch(concurrency)

          return channel
        }
      )
    }

    return this.subscriberChannels[concurrency]
  }

  private getSubscribersWithConcurrency(concurrency: number) {
    return this.subscribers.filter(
      (subscriber) => getConcurrency(subscriber) === concurrency
    )
  }

  private getQueueOptions(subscriber: Subscriber<Buffer>): Options.AssertQueue {
    const options: Options.AssertQueue = { durable: true }

    if (hasDeadLetterTopic(subscriber)) {
      options.deadLetterExchange = this.exchange
      options.deadLetterRoutingKey = getDeadLetterTopic(subscriber)!
    }

    return options
  }
}

function convertMessage(amqpMessage: ConsumeMessage): Message<Buffer> {
  const message: Message<Buffer> = {
    topic: amqpMessage.fields.routingKey,
    headers: amqpMessage.properties.headers as Record<string, string>,
    properties: {
      id: amqpMessage.properties.messageId ?? cuid(),
      date: new Date(
        amqpMessage.properties.headers[dateHeader] ??
          (amqpMessage.properties.timestamp != null
            ? amqpMessage.properties.timestamp * 1000
            : Date.now())
      )
    },
    body: amqpMessage.content
  }

  if (
    amqpMessage.properties.contentType &&
    getHeader(message, 'content-type') === undefined
  ) {
    message.headers['Content-Type'] = amqpMessage.properties.contentType
  }
  if (
    amqpMessage.properties.contentEncoding &&
    getHeader(message, 'content-encoding') === undefined
  ) {
    message.headers['Content-Encoding'] = amqpMessage.properties.contentEncoding
  }

  return message
}
