import { Channel, Connection, MessageProperties } from 'amqplib'
import { ConsumeMessage, Options } from 'amqplib/properties'
import assert from 'assert'
import cuid from 'cuid'
import { EventEmitter } from 'events'
import { BackendSubscriber, Message } from '../../types'
import {
  getConcurrency,
  getDeadLetterQueueName,
  getDeadLetterTopic,
  getHeader,
  hasDeadLetterTopic
} from '../../util'
import { convertBindingWildcards } from './util'

const DATE_HEADER = 'x-announce-date'

export class Queue extends EventEmitter {
  private channel!: Promise<Channel>
  readonly ready: Promise<void>

  constructor(
    private readonly connection: Connection,
    private readonly exchange: string,
    private readonly subscriber: BackendSubscriber
  ) {
    super()

    this.ready = this.initialize()

    this.watchPromise(this.ready)
    this.on('error', () => this.close())
  }

  async bindTopics(topics: readonly string[]) {
    const channel = await this.channel

    await Promise.all(
      topics.map((topic) =>
        channel.bindQueue(
          this.subscriber.queueName,
          this.exchange,
          convertBindingWildcards(topic)
        )
      )
    )
  }

  async close() {
    const channel = await this.channel

    try {
      await channel.close()
    } catch {
      // It may already be closed
    }
  }

  private async initialize() {
    if (this.channel) {
      try {
        const channel = await this.channel
        await channel.close()
      } catch {
        // The channel might already be dead
      }
    }

    this.channel = this.createChannel()
    await this.setUpQueue()
  }

  private async createChannel(): Promise<Channel> {
    const channel = await this.connection.createChannel()
    channel.on('error', (err) => this.emit('error', err))
    await channel.prefetch(getConcurrency(this.subscriber))

    return channel
  }

  private async setUpQueue(): Promise<void> {
    const subscriber = this.subscriber
    const channel = await this.channel
    const options = this.getQueueOptions(subscriber)
    const deadLetterRoutingKey = options.deadLetterRoutingKey
    const deadLetterQueueName = getDeadLetterQueueName(subscriber)

    if (deadLetterRoutingKey && deadLetterQueueName) {
      await channel.assertQueue(deadLetterQueueName, { durable: true })
      await channel.bindQueue(
        deadLetterQueueName,
        this.exchange,
        deadLetterRoutingKey
      )
    }

    await channel.assertQueue(subscriber.queueName, options)
    await this.bindTopics(subscriber.topics)
    await this.consume()
  }

  private getQueueOptions(subscriber: BackendSubscriber): Options.AssertQueue {
    const options: Options.AssertQueue = { durable: true }

    if (hasDeadLetterTopic(subscriber)) {
      const deadLetterRoutingKey = getDeadLetterTopic(subscriber)
      assert(deadLetterRoutingKey)

      options.deadLetterExchange = this.exchange
      options.deadLetterRoutingKey = deadLetterRoutingKey
    }

    return options
  }

  private async consume(): Promise<void> {
    const channel = await this.channel
    await channel.consume(this.subscriber.queueName, async (message) => {
      if (!message) {
        // Notification that something interesting has happened on the
        // channel, eg a queue has been deleted. We don't know what
        // the event was, so all we can do is build a new channel
        await this.watchPromise(this.initialize())
      } else {
        let succeeded: boolean

        try {
          await this.subscriber.handle(convertMessage(message))
          succeeded = true
        } catch (e) {
          succeeded = false
        }

        try {
          if (succeeded) {
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

  private watchPromise(promise: Promise<unknown>) {
    promise.catch((e) => this.emit('error', e))
  }
}

function convertMessage(amqpMessage: ConsumeMessage): Message<Buffer> {
  const message: Message<Buffer> = {
    topic: amqpMessage.fields.routingKey,
    headers: amqpMessage.properties.headers as Record<string, string>,
    properties: {
      id: amqpMessage.properties.messageId ?? cuid(),
      date: getMessageDate(amqpMessage.properties)
    },
    body: amqpMessage.content
  }

  setHeaderFromProperties(message, amqpMessage.properties, 'contentType')
  setHeaderFromProperties(message, amqpMessage.properties, 'contentEncoding')

  return message
}

function setHeaderFromProperties(
  message: Message,
  properties: MessageProperties,
  property: keyof MessageProperties
) {
  const header = property.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`
  )

  if (properties[property] && getHeader(message, header) === undefined) {
    message.headers[header] = properties[property]
  }
}

function getMessageDate(properties: MessageProperties): Date {
  if (properties.headers[DATE_HEADER]) {
    return new Date(properties.headers[DATE_HEADER])
  } else if (properties.timestamp != null) {
    return new Date(properties.timestamp * 1000)
  } else {
    return new Date()
  }
}
