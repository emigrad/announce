import { Channel, ConfirmChannel, Connection } from 'amqplib'
import { EventEmitter } from 'events'
import { rejectMultipleSubscriptions } from '../../polyfills'
import { Backend, BackendSubscriber, Message, Middleware } from '../../types'
import { getHeader } from '../../util'
import { Queue } from './Queue'

const dateHeader = 'x-announce-date'

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
  private readonly url: URL
  private readonly exchange: string
  private readonly queuesByName: Record<string, Queue> = {}
  private connection: Promise<Connection>
  private publishChannel: PromiseLike<ConfirmChannel> | undefined
  private closePromise: Promise<void> | undefined

  static accepts(url: string) {
    return /^amqps?:\/\//.test(url)
  }

  constructor(url: string) {
    super()

    this.url = new URL(url)
    this.exchange = this.url.pathname.length
      ? this.url.pathname.slice(1)
      : 'events'
    this.connection = this.connect()

    this.on('error', (error) => this.close(error))
    this.watchPromise(this.connection)
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
    const connection = await this.connection
    const queue = new Queue(connection, this.exchange, subscriber)
    queue.on('error', () => {
      delete this.queuesByName[subscriber.queueName]
    })

    this.queuesByName[subscriber.queueName] = queue
    await queue.ready
  }

  async isSubscribed(queueName: string): Promise<boolean> {
    return queueName in this.queuesByName
  }

  async destroyQueue(queueName: string): Promise<void> {
    const channel = await this.getPublishChannel()

    await channel.deleteQueue(queueName)
    delete this.queuesByName[queueName]
  }

  async close(
    reason: string | Error = 'Connection has been closed'
  ): Promise<void> {
    if (!this.closePromise) {
      const connectionPromise = this.connection

      // Prevent any attempts to publish messages or add subscribers
      this.connection = Promise.reject(reason)
      // Avoid Node complaining about unhanded rejections
      this.connection.then(null, () => {
        // Squelch
      })

      this.closePromise = (async () => {
        try {
          const connection = await connectionPromise
          await connection.close()
        } catch {
          // Squelch - we are closing anyway
        }
      })()

      Object.keys(this.queuesByName).forEach((queueName) => {
        delete this.queuesByName[queueName]
      })
    }

    return this.closePromise
  }

  getPolyfills(): Middleware[] {
    return [rejectMultipleSubscriptions(this)]
  }

  private async getPublishChannel(
    connection?: Connection
  ): Promise<ConfirmChannel> {
    if (!connection) {
      // We need to await the main connection even if we already have a
      // publish channel because if we've closed we will have replaced it
      // with a rejected promise
      connection = await this.connection
    }

    if (!this.publishChannel) {
      this.publishChannel = connection.createConfirmChannel()
    }

    return this.publishChannel
  }

  private async createExchange(channel: Channel): Promise<void> {
    await channel.assertExchange(this.exchange, 'topic')
  }

  private async connect(): Promise<Connection> {
    const amqplib = await getAmqpLib()
    const connection = await amqplib.connect(getServerUrl(this.url))

    connection.on('error', (e) => this.emit('error', e))
    const channel = await this.getPublishChannel(connection)
    await this.createExchange(channel)

    return connection
  }

  private watchPromise(promise: Promise<unknown>) {
    promise.catch((error) => this.emit('error', error))
  }
}

function getServerUrl({ protocol, host, username, password }: URL): string {
  const hasCredentials = username.length || password.length
  const credentials = hasCredentials ? `${username}:${password}@` : ''

  return `${protocol}//${credentials}${host}`
}

async function getAmqpLib(): Promise<AmqplibModule> {
  try {
    return await import('amqplib')
  } catch {
    throw new Error(
      'Unable to import amqplib package. This package is needed to connect to RabbitMQ. ' +
        'Please add it to your package.json by running npm i amqplib'
    )
  }
}

type AmqplibModule = typeof import('amqplib')
