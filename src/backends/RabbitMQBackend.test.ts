import { Channel, connect, Connection } from 'amqplib'
import cuid from 'cuid'
import { config } from 'dotenv-flow'
import { Deferred } from 'ts-deferred'
import { Headers, Subscriber } from '../types'
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
    const headers: Headers = {
      id: cuid(),
      published: '2020-01-02T18:19:20.000Z',
      header1: 'Test'
    }
    const body = { hi: 'there' }
    const subscriber: Subscriber<any> = {
      name: queueName,
      topics: ['test.*'],
      async handle(message) {
        dfd.resolve(message)
      }
    }

    await rabbitMq.subscribe(subscriber)
    await rabbitMq.publish({ body, headers, topic })

    expect(await dfd.promise).toMatchObject({ body, headers })
  })

  it('Should only process relevant messages', async () => {
    const queueName1 = `${queueName}1`
    const queueName2 = `${queueName}2`
    await channel.deleteQueue(queueName1)
    await channel.deleteQueue(queueName2)

    const dfd1 = new Deferred()
    const dfd2 = new Deferred()
    const headers: Headers = {
      id: cuid(),
      published: '2020-01-02T18:19:20.000Z',
      header1: 'Test'
    }
    const subscriber1: Subscriber<any> = {
      name: queueName1,
      topics: ['test.test1'],
      async handle({ body }) {
        dfd1.resolve(body)
      }
    }
    const subscriber2: Subscriber<any> = {
      name: queueName2,
      topics: ['test.test2'],
      async handle({ body }) {
        dfd2.resolve(body)
      }
    }

    await rabbitMq.subscribe(subscriber1)
    await rabbitMq.subscribe(subscriber2)

    await rabbitMq.publish({ body: { id: 1 }, headers, topic: 'test.test1' })
    await rabbitMq.publish({ body: { id: 2 }, headers, topic: 'test.test2' })

    expect(await dfd1.promise).toMatchObject({ id: 1 })
    expect(await dfd2.promise).toMatchObject({ id: 2 })
  })

  it.each([false, true, undefined])(
    'Should honour DLQ setting (%p)',
    async (enableDlq) => {
      const topic = 'test.test1'
      const headers: Headers = {
        id: cuid(),
        published: new Date().toISOString()
      }
      const subscriber: Subscriber<any> = {
        name: queueName,
        topics: [topic],
        options: { deadLetterQueue: enableDlq },
        async handle() {
          throw new Error('Nope')
        }
      }

      const dlq = `-dlq-${subscriber.name}`
      await channel.deleteQueue(dlq)

      await rabbitMq.subscribe(subscriber)
      await rabbitMq.publish({ body: { id: 1 }, headers, topic })

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
    const headers: Headers = {
      id: cuid(),
      published: '2020-01-02T18:19:20.000Z'
    }
    const receivedMessageTimes: number[] = []
    const subscriber: Subscriber<any> = {
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
      await rabbitMq.publish({ body: null, headers, topic })
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
    const headers: Headers = { id: cuid(), published: new Date().toISOString() }
    const body = null

    await rabbitMq.publish({ body, headers, topic })
  })

  it('Should handle publish errors', async () => {
    const topic = String(Math.random())
    const headers: Headers = { id: cuid(), published: new Date().toISOString() }
    const body = null

    await rabbitMq.publish({ body, headers, topic })

    const publishChannel = await (rabbitMq as any).publishChannel
    await publishChannel.close()

    await expect(
      rabbitMq.publish({ body, headers, topic })
    ).rejects.toBeDefined()
  })

  it('Should emit error if queue deleted', async () => {
    const dfd = new Deferred()
    const subscriber: Subscriber<any> = {
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
      rabbitMq.publish({
        body: null,
        headers: { id: '1', published: new Date().toString() },
        topic: String(Math.random())
      })
    ).rejects.toBeDefined()
    await dfd.promise
  })

  it('Should detect connection errors', async () => {
    const dfd = new Deferred()
    const error = new Error()

    rabbitMq.on('error', (err) => dfd.resolve(err))
    await rabbitMq.publish({
      body: null,
      headers: { id: '1', published: new Date().toString() },
      topic: String(Math.random())
    })

    const connection = await (rabbitMq as any).connection
    connection.emit('error', error)

    expect(await dfd.promise).toBe(error)
  })
})

function squelch() {}
