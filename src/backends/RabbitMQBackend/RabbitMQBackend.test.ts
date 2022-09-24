import { Channel, Connection, connect } from 'amqplib'
import { ConsumeMessage } from 'amqplib/properties'
import assert from 'assert'
import { config } from 'dotenv-flow'
import { Deferred } from 'ts-deferred'
import { BackendSubscriber, Message } from '../../types'
import {
  createMessage,
  getCompleteMessage,
  getDeadLetterQueueName,
  getHeader
} from '../../util'
import { RabbitMQBackend } from './RabbitMQBackend'
import SpyInstance = jest.SpyInstance

config({ silent: true, purge_dotenv: true })
const url = process.env.RABBITMQ_URL ?? ''

describe('RabbitMQ Backend', () => {
  let connection: Connection
  let channel: Channel
  let rabbitMq: RabbitMQBackend
  let handles: (() => Promise<void>)[]
  const exchange = 'test'
  const queueName = 'test.mq-backend.queue'

  beforeAll(async () => {
    connection = await connect(url)
  })

  beforeEach(async () => {
    handles = []
    if (channel) {
      await channel.close().catch(squelch)
    }

    channel = await connection.createChannel()
    // Squelch channel error events so they don't break our tests
    channel.on('error', squelch)

    await channel.deleteQueue(queueName)
    rabbitMq = new RabbitMQBackend(`${url}/${exchange}`)
    rabbitMq.on('error', squelch)
  })

  afterEach(async () => {
    await Promise.all(handles.map((handle) => handle()))
    await rabbitMq.close()
    jest.unmock('amqplib')
  })

  afterAll(() => connection.close())

  it.each(['amqp', 'amqps', 'http'])(
    'Should accept relevant protocols (%p)',
    (protocol) => {
      expect(RabbitMQBackend.accepts(`${protocol}://localhost`)).toBe(
        protocol.startsWith('amqp')
      )
    }
  )

  it("Should throw a helpful message if amqplib isn't available", async () => {
    const expectedError = {
      message: expect.stringContaining(
        'Unable to import amqplib package. This package is needed to connect to RabbitMQ.'
      )
    }
    jest.mock('amqplib', () => {
      throw new Error('Not installed')
    })

    const dfd = new Deferred()
    const backend = new RabbitMQBackend(url)
    backend.on('error', (err) => dfd.resolve(err))

    expect(await dfd.promise).toMatchObject(expectedError)

    await expect(
      backend.publish(
        getCompleteMessage(createMessage('test', Buffer.from('Hi there')))
      )
    ).rejects.toMatchObject(expectedError)
  })

  it('Rejected messages should be sent to the DLQ', async () => {
    let counter = 0
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
      queueName: queueName,
      topics: ['test.*'],
      async handle() {
        counter++
        throw new Error()
      }
    }
    const deadLetterQueueName = getDeadLetterQueueName(subscriber) as string
    const dlqSubscriber: BackendSubscriber = {
      queueName: deadLetterQueueName,
      topics: [],
      handle: dfd.resolve,
      options: { preserveRejectedMessages: false }
    }

    await channel.deleteQueue(dlqSubscriber.queueName)

    await rabbitMq.subscribe(subscriber)
    await rabbitMq.subscribe(dlqSubscriber)
    await rabbitMq.publish(getCompleteMessage(message))

    expect(await dfd.promise).toMatchObject({ body: message.body })
    expect(counter).toBe(1)
  })

  it('Should only process relevant messages', async () => {
    const queueName1 = `${queueName}1`
    const queueName2 = `${queueName}2`
    await channel.deleteQueue(queueName1)
    await channel.deleteQueue(queueName2)

    const dfd1 = new Deferred<Buffer>()
    const dfd2 = new Deferred<Buffer>()
    const subscriber1: BackendSubscriber = {
      queueName: queueName1,
      topics: ['test.test1'],
      async handle({ body }) {
        dfd1.resolve(body)
      }
    }
    const subscriber2: BackendSubscriber = {
      queueName: queueName2,
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
    async (preserveRejectedMessages) => {
      const topic = 'test.test1'
      const subscriber: BackendSubscriber = {
        queueName: queueName,
        topics: [topic],
        options: { preserveRejectedMessages },
        async handle() {
          throw new Error('Nope')
        }
      }

      const dlq = `~rejected-${subscriber.queueName}`
      await channel.deleteQueue(dlq)

      await rabbitMq.subscribe(subscriber)
      await rabbitMq.publish(
        getCompleteMessage({ topic, body: Buffer.from('') })
      )

      if (
        preserveRejectedMessages === true ||
        preserveRejectedMessages === undefined
      ) {
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
      queueName: queueName,
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

    const publishChannel = await rabbitMq['publishChannel']
    await publishChannel?.close()

    await expect(
      rabbitMq.publish(getCompleteMessage({ topic, body }))
    ).rejects.toBeDefined()
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

    const connection = await rabbitMq['connection']
    connection.emit('error', error)

    expect(await dfd.promise).toBe(error)
  })

  it("Should generate a message ID if it's missing", async () => {
    const dfd = new Deferred<Message<Buffer>>()
    await rabbitMq.subscribe({
      queueName: queueName,
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
      queueName: queueName,
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
      queueName: queueName,
      topics: [],
      handle: dfd.resolve
    })
    channel.publish('', queueName, Buffer.from(''))
    const receivedMessage = await dfd.promise

    expect(+receivedMessage.properties.date).toBeGreaterThanOrEqual(start)
    expect(+receivedMessage.properties.date).toBeLessThanOrEqual(Date.now())
  })

  it('Should set the contentType and contentEncoding properties from the headers', async () => {
    const dfd = new Deferred<ConsumeMessage | null>()
    const testQueueName = `${queueName}.${Math.random()}`
    const contentType = 'foo'
    const contentEncoding = 'bar'

    await channel.assertQueue(testQueueName, {
      durable: false,
      autoDelete: true
    })
    await channel.bindQueue(testQueueName, exchange, testQueueName)
    await channel.consume(testQueueName, dfd.resolve)

    await rabbitMq.publish(
      getCompleteMessage({
        topic: testQueueName,
        body: Buffer.from(''),
        headers: {
          'Content-Type': contentType,
          'Content-Encoding': contentEncoding
        }
      })
    )

    const receivedMessage = await dfd.promise

    expect(receivedMessage?.properties).toMatchObject({
      contentType,
      contentEncoding
    })
  })

  it.each([
    ['Content-Type', false],
    ['Content-Type', false],
    ['Content-Encoding', true],
    ['Content-Encoding', false]
  ])(
    "Should set the %p header from the property if it's not already defined",
    async (header, alreadyDefined) => {
      const dfd = new Deferred<Message<Buffer>>()
      await rabbitMq.subscribe({
        queueName: queueName,
        topics: [],
        handle: dfd.resolve
      })
      const headerValue = 'header value'
      const propertyValue = 'property value'
      const headers: Record<string, string> = {}
      if (alreadyDefined) {
        headers[header] = headerValue
      }

      channel.publish('', queueName, Buffer.from(''), {
        headers,
        [header === 'Content-Type' ? 'contentType' : 'contentEncoding']:
          propertyValue
      })
      const receivedMessage = await dfd.promise

      expect(getHeader(receivedMessage, header)).toBe(
        alreadyDefined ? headerValue : propertyValue
      )
    }
  )

  it('Should rebuild the channel when a null message is received', async () => {
    const topic = 'test'
    const messageDeferred = new Deferred()
    const closedDfd = new Deferred()
    const backendConnection = await rabbitMq['connection']

    // Force the backend to create the channel
    const subscriber: BackendSubscriber = {
      queueName: queueName,
      topics: [topic],
      handle: () => messageDeferred.resolve()
    }

    let consumeSpy!: SpyInstance
    let subscribeChannelPromise!: PromiseLike<Channel>
    const origCreateChannel = backendConnection.createChannel
    jest
      .spyOn(backendConnection, 'createChannel')
      .mockImplementation(function (this: Connection) {
        const promise = origCreateChannel.call(this).then((channel) => {
          consumeSpy = jest.spyOn(channel, 'consume')

          return channel
        })
        subscribeChannelPromise = promise as never

        return promise
      } as never)
    await rabbitMq.subscribe(subscriber)

    const subscribeChannel = await subscribeChannelPromise
    const origClose = subscribeChannel.close
    subscribeChannel.close = jest.fn(async () => {
      await origClose.call(subscribeChannel)
      closedDfd.resolve()
    }) as never

    const consumer = consumeSpy.mock.calls[0][1]
    await consumer(null)

    await closedDfd.promise

    // Since the channel has been closed, we will only receive the messages
    // if it's rebuilt
    channel.publish(exchange, topic, Buffer.from(''))

    await messageDeferred.promise
  })

  it('Should reject the promise if a publish fails', async () => {
    const error = new Error()

    // Create the publish channel
    await rabbitMq.publish(
      getCompleteMessage({ topic: 'hi', body: Buffer.from('') })
    )
    const publishChannel = await rabbitMq['publishChannel']
    assert(publishChannel)

    publishChannel.publish = jest.fn(
      (
        _: unknown,
        __: unknown,
        ___: unknown,
        ____: unknown,
        callback: (err: unknown, ok: unknown) => void
      ) => {
        callback(error, null)

        return true
      }
    )

    await expect(
      rabbitMq.publish(
        getCompleteMessage({ topic: 'hi', body: Buffer.from('') })
      )
    ).rejects.toBe(error)
  })

  it.each([new Error('Oh no'), 'Oh no'])(
    'if the connection closes with an error, subsequent operations should fail with that error (%p)',
    async (error) => {
      const connection = await rabbitMq['connection']
      connection.emit('error', error)

      await Promise.resolve()
      await expect(
        rabbitMq.publish(
          getCompleteMessage({ topic: 'hi', body: Buffer.from('') })
        )
      ).rejects.toBe(error)
    }
  )

  it('should correctly send username/password', async () => {
    // const connect = jest.fn().mockRejectedValue('blah')
    let connectUrl!: string
    jest.mock('amqplib', () => ({
      connect(_connectUrl: string) {
        connectUrl = _connectUrl
        throw new Error('blah')
      }
    }))

    const username = 'user with a space'
    const password = 'letmein?'
    const urlWithCredentials = url.replace(
      '://',
      `://${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    )
    const backend = new RabbitMQBackend(urlWithCredentials)

    handles.push(() => backend.close())

    await backend
      .publish(getCompleteMessage({ topic: 'test', body: Buffer.from('') }))
      .catch(() => {
        // We're expecting it to fail
      })
    expect(connectUrl).toBe(urlWithCredentials)
  })
})

function squelch() {
  // Do nothing
}
