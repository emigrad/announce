import { Channel, ConfirmChannel, connect, Connection } from 'amqplib'
import { ConsumeMessage, Options } from 'amqplib/properties'
import { EventEmitter } from 'events'
import { getConcurrency, hasDeadLetterQueue } from '../selectors'
import { Backend, Message, Subscriber } from '../types'

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
  private readonly subscribers: Subscriber<any>[]
  private readonly subscriberChannels: Record<number, PromiseLike<Channel>>
  private readonly rebuildPromises: Record<number, PromiseLike<any>>
  private connection: PromiseLike<Connection>
  private publishChannel: PromiseLike<ConfirmChannel> | undefined
  private closePromise: Promise<void> | undefined

  static accepts(url: string) {
    return url.startsWith('amqp://')
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
        ensureCleanShutdown(connection)
        connection.on('error', (err) => this.emit('error', err))
      },
      (err) => this.emit('error', err)
    )
  }

  async publish(message: Message<any>): Promise<void> {
    const publishChannel = await this.getPublishChannel()
    const { id: messageId, published, ...headers } = message.headers
    const timestamp = Math.floor(+new Date(published) / 1000)

    return new Promise((resolve, reject) => {
      publishChannel.publish(
        this.exchange,
        message.topic,
        Buffer.from(JSON.stringify(message.body)),
        { headers, timestamp, messageId, persistent: true },
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

  async subscribe(subscriber: Subscriber<any>): Promise<void> {
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
        // deleted then this will fail
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

  private async createQueue(subscriber: Subscriber<any>): Promise<void> {
    const channel = await this.getChannelForSubscriber(subscriber)
    const options = getQueueOptions(subscriber)

    await this.createExchange(channel)
    await channel.assertQueue(subscriber.name, options)

    if (options.deadLetterRoutingKey) {
      await channel.assertQueue(options.deadLetterRoutingKey, { durable: true })
    }

    await Promise.all(
      subscriber.topics.map((topic) =>
        channel.bindQueue(subscriber.name, this.exchange, topic)
      )
    )
  }

  private async consume(subscriber: Subscriber<any>): Promise<void> {
    const channel = await this.getChannelForSubscriber(subscriber)

    await channel.consume(subscriber.name, async (message) => {
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
            channel.nack(message)
          }
        } catch (e) {
          // Ignore errors when attempting to ack/nack the message since
          // we already handle channel failures elsewhere
        }
      }
    })
  }

  private async getChannelForSubscriber(
    subscriber: Subscriber<any>
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
}

function getQueueOptions(subscriber: Subscriber<any>): Options.AssertQueue {
  const options: Options.AssertQueue = { durable: true }

  if (hasDeadLetterQueue(subscriber)) {
    options.deadLetterExchange = ''
    options.deadLetterRoutingKey = `-dlq-${subscriber.name}`
  }

  return options
}

function convertMessage(message: ConsumeMessage): Message<any> {
  return {
    topic: message.fields.routingKey,
    headers: {
      ...(message.properties.headers as Record<string, string>),
      id: message.properties.messageId,
      published: new Date(message.properties.timestamp * 1000).toISOString()
    },
    body: JSON.parse(message.content.toString())
  }
}

/**
 * It's possible for an error to cause the AMQP connection with the server to
 * close, but the underlying TCP connection stays alive (if we don't receive
 * a TCP ACK reply to our FIN packet). This function ensures that the TCP
 * connection is always fully destroyed so that we don't end up with dangling
 * Node handles keeping the process alive
 */
export function ensureCleanShutdown(connection: Connection) {
  const stream = (connection as any).connection?.stream

  if (!stream) {
    throw new Error('Unable to patch amqplib')
  }

  connection.on('close', () => {
    setTimeout(() => {
      stream.destroy()
    }, 1000)
  })
}
