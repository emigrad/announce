import { Channel, connect, Connection } from 'amqplib'
import { config } from 'dotenv-flow'
import { Deferred } from 'ts-deferred'
import { BackendSubscriber, Message } from '../types'
import { createMessage, getCompleteMessage } from '../util'
import { RabbitMQBackend } from './RabbitMQBackend'

config({ silent: true, purge_dotenv: true })
const url = process.env.RABBITMQ_URL!

describe('RabbitMQ Backend', () => {
  let connection: Connection
  let channel: Channel
  let rabbitMq: RabbitMQBackend
  const exchange = 'test'
  const queueName = 'test.mq-backend.queue'

  beforeAll(async () => {
    connection = await connect(url)
  })

  beforeEach(async () => {
    if (channel) {
      await channel.close().catch(squelch)
    }

    channel = await connection.createChannel()
    // Squelch channel error events so they don't break our tests
    channel.on('error', squelch)

    await channel.deleteQueue(queueName)
    rabbitMq = new RabbitMQBackend(url, { exchange })
    rabbitMq.on('error', squelch)
  })

  afterEach(() => rabbitMq.close())

  afterAll(() => connection.close())

  it('Should be able to process messages', async () => {
    const dfd = new Deferred()
    const topic = 'test.test1'
    const message = createMessage(
      topic,
      Buffer.from('hi there'),
      { header1: 'Test' },
      {
        date: new Date('2020-01-02T18:19:20.123Z')
      }
    )
    const subscriber: BackendSubscriber = {
      name: queueName,
      topics: ['test.*'],
      async handle(message) {
        dfd.resolve(message)
      }
    }

    await rabbitMq.subscribe(subscriber)
    await rabbitMq.publish(getCompleteMessage(message))

    expect(await dfd.promise).toMatchObject(message)
  })

  it('Should only process relevant messages', async () => {
    const queueName1 = `${queueName}1`
    const queueName2 = `${queueName}2`
    await channel.deleteQueue(queueName1)
    await channel.deleteQueue(queueName2)

    const dfd1 = new Deferred<Buffer>()
    const dfd2 = new Deferred<Buffer>()
    const subscriber1: BackendSubscriber = {
      name: queueName1,
      topics: ['test.test1'],
      async handle({ body }) {
        dfd1.resolve(body)
      }
    }
    const subscriber2: BackendSubscriber = {
      name: queueName2,
      topics: ['test.test2'],
      async handle({ body }) {
        dfd2.resolve(body)
      }
    }

    await rabbitMq.subscribe(subscriber1)
    await rabbitMq.subscribe(subscriber2)

    await rabbitMq.publish(
      getCompleteMessage({ topic: 'test.test1', body: Buffer.from('1') })
    )
    await rabbitMq.publish(
      getCompleteMessage({ topic: 'test.test2', body: Buffer.from('2') })
    )

    expect((await dfd1.promise).toString()).toBe('1')
    expect((await dfd2.promise).toString()).toBe('2')
  })

  it.each([false, true, undefined])(
    'Should honour DLQ setting (%p)',
    async (enableDlq) => {
      const topic = 'test.test1'
      const subscriber: BackendSubscriber = {
        name: queueName,
        topics: [topic],
        options: { deadLetterQueue: enableDlq },
        async handle() {
          throw new Error('Nope')
        }
      }

      const dlq = `~dlq-${subscriber.name}`
      await channel.deleteQueue(dlq)

      await rabbitMq.subscribe(subscriber)
      await rabbitMq.publish(
        getCompleteMessage({ topic, body: Buffer.from('') })
      )

      if (enableDlq === true || enableDlq === undefined) {
        const dfd = new Deferred()
        await channel.consume(dlq, () => dfd.resolve())
        await dfd
      } else {
        // The DLQ should not exist
        await expect(channel.checkQueue(dlq)).rejects.toBeDefined()
      }
    }
  )

  it('Should honour concurrency limit', async () => {
    const dfd = new Deferred()
    const topic = 'test.test1'
    const concurrency = 3
    const numMessages = 5
    const delay = 50
    const receivedMessageTimes: number[] = []
    const subscriber: BackendSubscriber = {
      name: queueName,
      topics: ['test.*'],
      options: { concurrency },
      async handle() {
        receivedMessageTimes.push(Date.now())
        if (receivedMessageTimes.length === numMessages) {
          dfd.resolve()
        }

        return new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    await rabbitMq.subscribe(subscriber)

    for (let i = 0; i < numMessages; i++) {
      await rabbitMq.publish(
        getCompleteMessage({ topic, body: Buffer.from('') })
      )
    }

    await dfd.promise

    for (let i = 1; i < concurrency; i++) {
      expect(
        receivedMessageTimes[i] - receivedMessageTimes[i - 1]
      ).toBeLessThan(delay)
    }
    for (let i = concurrency; i < numMessages; i++) {
      expect(
        receivedMessageTimes[i] - receivedMessageTimes[i - concurrency]
      ).toBeGreaterThan(delay * 0.9)
    }
  })

  it('publish() should still succeed even if there are no consumers', async () => {
    const topic = String(Math.random())
    const body = Buffer.from('')

    await rabbitMq.publish(getCompleteMessage({ topic, body }))
  })

  it('Should handle publish errors', async () => {
    const topic = String(Math.random())
    const body = Buffer.from('')

    await rabbitMq.publish(getCompleteMessage({ topic, body }))

    const publishChannel = await (rabbitMq as any).publishChannel
    await publishChannel.close()

    await expect(
      rabbitMq.publish(getCompleteMessage({ topic, body }))
    ).rejects.toBeDefined()
  })

  it('Should emit error if queue deleted', async () => {
    const dfd = new Deferred()
    const subscriber: BackendSubscriber = {
      name: queueName,
      topics: ['test.*'],
      async handle(message) {
        dfd.resolve(message)
      }
    }

    await rabbitMq.subscribe(subscriber)
    rabbitMq.on('error', (error) => dfd.resolve(error))

    await channel.deleteQueue(subscriber.name)
    await dfd.promise
  })

  it('Should detect inability to connect', async () => {
    await rabbitMq.close()
    const dfd = new Deferred()

    // Nothing should be listening on port 50
    rabbitMq = new RabbitMQBackend('amqp://localhost:50')
    rabbitMq.on('error', (err) => dfd.resolve(err))

    await expect(
      rabbitMq.publish(
        getCompleteMessage({
          topic: String(Math.random()),
          body: Buffer.from('')
        })
      )
    ).rejects.toBeDefined()
    await dfd.promise
  })

  it('Should detect connection errors', async () => {
    const dfd = new Deferred()
    const error = new Error()

    rabbitMq.on('error', (err) => dfd.resolve(err))
    await rabbitMq.publish(
      getCompleteMessage({
        topic: String(Math.random()),
        body: Buffer.from('')
      })
    )

    const connection = await (rabbitMq as any).connection
    connection.emit('error', error)

    expect(await dfd.promise).toBe(error)
  })

  it("Should generate a message ID if it's missing", async () => {
    const dfd = new Deferred<Message<Buffer>>()
    await rabbitMq.subscribe({
      name: queueName,
      topics: [],
      handle: dfd.resolve
    })
    channel.publish('', queueName, Buffer.from(''))
    const receivedMessage = await dfd.promise

    expect(receivedMessage.properties.id).toBeDefined()
  })

  it('Should fall back on the message timestamp if the date header is undefined', async () => {
    const dfd = new Deferred<Message<Buffer>>()
    const date = new Date('2020-04-06 12:34:56.000Z')
    await rabbitMq.subscribe({
      name: queueName,
      topics: [],
      handle: dfd.resolve
    })
    channel.publish('', queueName, Buffer.from(''), { timestamp: +date / 1000 })
    const receivedMessage = await dfd.promise

    expect(receivedMessage.properties.date).toEqual(date)
  })

  it('Should fall back on Date.now() if the message is completely undated', async () => {
    const dfd = new Deferred<Message<Buffer>>()
    const start = Date.now()
    await rabbitMq.subscribe({
      name: queueName,
      topics: [],
      handle: dfd.resolve
    })
    channel.publish('', queueName, Buffer.from(''))
    const receivedMessage = await dfd.promise

    expect(+receivedMessage.properties.date).toBeGreaterThanOrEqual(start)
    expect(+receivedMessage.properties.date).toBeLessThanOrEqual(Date.now())
  })
})

function squelch() {}
