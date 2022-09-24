import assert from 'assert'
import { createHash } from 'crypto'
import { config } from 'dotenv-flow'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Deferred } from 'ts-deferred'
import { Announce } from '../Announce'
import { BackendSubscriber, Message, Subscriber } from '../types'
import {
  createMessage,
  getCompleteMessage,
  getConcurrency,
  getDeadLetterQueueName,
  getDeadLetterTopic
} from '../util'

config({ silent: true, purge_dotenv: true })

const hash = createHash('md5').update(__filename).digest('hex').toString()
const basePath = resolve(tmpdir(), hash)

// Common tests that all backends must pass to ensure that they behave
// the same. If you're writing a new backend and one or more of these tests
// fails, a polyfill (in src/polyfills) might be available to implement
// the necessary behaviour

describe.each([
  ['InMemoryBackend', 'memory://', false],
  ['FileBackend', `file://${basePath}`, true],
  ['RabbitMQBackend', process.env.RABBITMQ_URL ?? '', true]
])('Common backend tests: %s', (_, url, supportsPersistence) => {
  let announce: Announce
  let handles: (() => unknown)[]

  beforeEach(async () => {
    announce = new Announce({ url })
    handles = []

    const deadLetterQueue = getDeadLetterQueueName({
      queueName: 'test'
    } as Subscriber)
    assert(deadLetterQueue)

    await announce.destroyQueue('test')
    await announce.destroyQueue(deadLetterQueue)
  })

  afterEach(async () => {
    await Promise.all(handles.map((handle) => handle()))
    await announce.close()
  })

  it('Should publish and receive messages', async () => {
    const dfd = new Deferred<Message<Buffer>>()
    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo.bar'],
      handle: (message) => dfd.resolve(message)
    }
    const message = getCompleteMessage({
      topic: 'foo.bar',
      body: Buffer.from('hi there')
    })

    await announce.subscribe(subscriber)
    await announce.publish(message)

    const receivedMessage = await dfd.promise

    expect(receivedMessage).toMatchObject(message)
    expect(receivedMessage.properties.date).toBeInstanceOf(Date)
  })

  it.each([
    ['foo.*', 'foo.bar', true],
    ['foo.*', 'foo', false],
    ['foo.*', 'foo.bar.baz', false],
    ['foo.*.baz', 'foo.bar.baz', true],
    ['*.bar.baz', 'foo.bar.baz', true],
    ['*.foo.baz', 'foo.bar.baz', false],
    ['**', 'foo', true],
    ['**', 'foo.bar', true],
    ['**.baz', 'foo.bar', false],
    ['**.baz', 'foo.baz.bar', false],
    ['**.baz', 'foo.bar.baz', true],
    ['foo.**', 'foo', true],
    ['foo.**', 'foo.bar.baz', true],
    ['foo.**.bar', 'foo.bar', true],
    ['foo.**.bar', 'foo.1.bar', true],
    ['foo.**.bar', 'foo.1.2.bar', true],
    ['foo.**.bar', 'foo.1.2.baz', false]
  ])(
    'Should support wildcards in topic selectors (selector: %p, topic: %p)',
    async (selector, topic, expected) => {
      const delay = 200
      const deferred = new Deferred<boolean>()
      let receivedMessage = false
      const subscriber: BackendSubscriber = {
        queueName: 'test',
        topics: [selector],
        handle: () => {
          receivedMessage = true
          deferred.resolve(true)
          clearTimeout(timeout)
        }
      }
      const message = createMessage(topic, Buffer.from('hi there'))
      const timeout = setTimeout(() => deferred.resolve(false), delay)

      await announce.subscribe(subscriber)
      await announce.publish(getCompleteMessage(message))

      await deferred.promise

      expect(receivedMessage).toBe(expected)
    }
  )

  it('Should honour concurrency', async () => {
    let numRunning = 0
    let maxRunning = 0
    const dfds = [
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred(),
      new Deferred()
    ]
    const done = Promise.all(dfds.map(({ promise }) => promise))

    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo'],
      handle: async ({ body }) => {
        expect(numRunning).toBeLessThan(getConcurrency(subscriber))
        numRunning++
        maxRunning = Math.max(maxRunning, numRunning)

        await new Promise((resolve) => setTimeout(resolve, 100))
        numRunning--
        dfds[+body.toString()].resolve()
      },
      options: { concurrency: 2 }
    }
    const message = createMessage('foo', null)
    await announce.subscribe(subscriber)

    await Promise.all(
      dfds.map((_, seq) => {
        return announce.publish(
          getCompleteMessage({ ...message, body: Buffer.from(String(seq)) })
        )
      })
    )
    await done

    expect(maxRunning).toBe(subscriber.options?.concurrency)
  })

  // InMemory and Rabbit both failing
  xit('should handle queues being deleted', async () => {
    const emitter = new EventEmitter()
    const subscriber: BackendSubscriber = {
      topics: ['foo.bar'],
      queueName: 'test',
      handle: () => {
        emitter.emit('message')
      },
      options: { concurrency: 3 }
    }
    const message = getCompleteMessage({
      topic: subscriber.topics[0],
      body: Buffer.from('hello')
    })
    const announce2 = new Announce({ url })
    handles.push(() => announce2.close())
    await announce.subscribe(subscriber)
    await announce2.subscribe(subscriber)
    const errors: unknown[] = []
    // Spam both backends with messages
    const messageSendInterval = setInterval(async () => {
      await Promise.all([announce.publish(message), announce2.publish(message)])
    }, 0)
    let messageCount = 0
    let mostRecentMessageTime = Infinity
    emitter.on('message', () => (mostRecentMessageTime = Date.now()))
    handles.push(() => clearInterval(messageSendInterval))
    announce.on('error', (error) => errors.push(error))
    announce2.on('error', (error) => errors.push(error))

    // Wait for a few messages to start coming through
    await new Promise<void>((resolve) => {
      emitter.on('message', handler)

      function handler() {
        if (++messageCount > 10) {
          emitter.removeListener('message', handler)
          resolve()
        }
      }
    })

    // Delete the queue
    await announce.destroyQueue(subscriber.queueName)

    // And wait for the messages to stop
    await new Promise<void>((resolve) => {
      const silenceTimer = setInterval(() => {
        if (mostRecentMessageTime < Date.now() - 300) {
          clearInterval(silenceTimer)
          resolve()
        }
      })
    })
    expect(errors).toHaveLength(0)
  })

  it('should handle multiple messages with the same ID', async () => {
    const copiesToPublish = 3
    const message = getCompleteMessage({
      topic: 'test',
      body: Buffer.from('hi there')
    })
    const receivedMessages: Message<Buffer>[] = []
    const receivedMessagesDeferred = new Deferred()
    const processMessageDeferred = new Deferred()

    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle: async (message) => {
        // Wait so that the messages all get queued up
        await processMessageDeferred.promise

        receivedMessages.push(message)
        if (receivedMessages.length === copiesToPublish) {
          receivedMessagesDeferred.resolve(receivedMessages)
        }
      }
    })

    for (let i = 0; i < copiesToPublish; i++) {
      await announce.publish(message)
    }

    processMessageDeferred.resolve()

    expect(await receivedMessagesDeferred.promise).toMatchObject(
      Array(copiesToPublish).fill(message)
    )
  })

  it.each([false, true])(
    'Should send rejected messages to the dead letter queue (currently subscribed: %p)',
    async (currentlySubscribed) => {
      const subscriberDfd = new Deferred()
      const dlqSubscriberDfd = new Deferred()
      const subscriber: BackendSubscriber = {
        queueName: 'test',
        topics: ['foo.bar'],
        handle: () => {
          subscriberDfd.resolve()
          return Promise.reject()
        }
      }
      const dlqName = getDeadLetterQueueName(subscriber)
      const dlqTopic = getDeadLetterTopic(subscriber)
      assert(dlqName && dlqTopic)
      const dlqSubscriber: BackendSubscriber = {
        queueName: dlqName,
        topics: [dlqTopic],
        handle: () => dlqSubscriberDfd.resolve(),
        options: { preserveRejectedMessages: false }
      }
      const message = getCompleteMessage({
        topic: 'foo.bar',
        body: Buffer.from('hi there')
      })

      await announce.subscribe(subscriber)

      if (currentlySubscribed) {
        await announce.subscribe(dlqSubscriber)
      }

      await announce.publish(message)
      await subscriberDfd.promise

      if (!currentlySubscribed) {
        await announce.subscribe(dlqSubscriber)
      }

      await subscriberDfd.promise
    }
  )

  it('should not allow multiple subscriptions to the same queue', async () => {
    const subscriber: Subscriber = {
      queueName: 'test',
      topics: ['test'],
      handle: () => Promise.resolve()
    }

    await announce.subscribe(subscriber)
    await expect(announce.subscribe(subscriber)).rejects.toBeInstanceOf(Error)
  })

  it('should allow resubscription after the queue has been destroyed', async () => {
    const subscriber: Subscriber = {
      queueName: 'test',
      topics: ['test'],
      handle: () => Promise.resolve()
    }

    await announce.subscribe(subscriber)
    await announce.destroyQueue(subscriber.queueName)
    await announce.subscribe(subscriber)
  })

  it('publish() should still succeed even if there are no consumers', async () => {
    const topic = String(Math.random())
    const body = Buffer.from('')

    await announce.publish(getCompleteMessage({ topic, body }))
  })

  if (supportsPersistence) {
    it('should allow resubscription after the queue has been destroyed remotely', async () => {
      const deferred = new Deferred()
      const subscriber: Subscriber = {
        queueName: 'test',
        topics: ['test'],
        handle: () => Promise.resolve()
      }

      await announce.subscribe(subscriber)

      const announce2 = new Announce({ url })
      await announce2.destroyQueue(subscriber.queueName)

      const timeout = setTimeout(() => {
        deferred.reject('Failed to resubscribe')
      }, 200)
      const interval = setInterval(async () => {
        try {
          await announce.subscribe(subscriber)
          deferred.resolve()
        } catch {
          // Do nothing - try again shortly
        }
      }, 10)

      handles.push(
        () => clearInterval(interval),
        () => clearTimeout(timeout)
      )

      await deferred.promise
    })
  }
})
