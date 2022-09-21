import assert from 'assert'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { readdir as readdirCb, utimes as utimesCb } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import rimrafCb from 'rimraf'
import { Deferred } from 'ts-deferred'
import { promisify } from 'util'
import { BackendSubscriber, Message } from '../../types'
import {
  createMessage,
  getCompleteMessage,
  getConcurrency,
  getDeadLetterQueueName,
  getDeadLetterTopic
} from '../../util'
import { PROCESSING_DIRECTORY, QUEUES_DIRECTORY } from './constants'
import { FileBackend } from './FileBackend'
import { getQueuePath } from './util'
import clearAllTimers = jest.clearAllTimers
import runOnlyPendingTimers = jest.runOnlyPendingTimers

const readdir = promisify(readdirCb)
const rimraf = promisify(rimrafCb)
const utimes = promisify(utimesCb)

describe('File backend', () => {
  const hash = createHash('md5').update(__filename).digest('hex').toString()
  const path = resolve(tmpdir(), hash)
  let handles: (() => unknown)[]
  let fileBackend: FileBackend

  beforeEach(async () => {
    await rimraf(path)
    fileBackend = new FileBackend(path)
    await fileBackend.ready
    handles = []
  })

  afterEach(async () => {
    jest.useRealTimers()
    await fileBackend.close()
    await Promise.all(handles.map((handle) => handle()))
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

    await fileBackend.subscribe(subscriber)
    await fileBackend.publish(message)

    const receivedMessage = await dfd.promise
    expect(receivedMessage).toMatchObject(message)
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
    ['foo.**', 'foo', false],
    ['foo.**', 'foo.bar.baz', true]
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

      await fileBackend.subscribe(subscriber)
      await fileBackend.publish(getCompleteMessage(message))

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
        numRunning++
        maxRunning = Math.max(maxRunning, numRunning)

        await new Promise((resolve) => setTimeout(resolve, 100))
        numRunning--
        dfds[+body.toString()].resolve()
      },
      options: { concurrency: 2 }
    }
    const message = createMessage('foo', null)
    await fileBackend.subscribe(subscriber)

    dfds.forEach((_, seq) =>
      fileBackend.publish(
        getCompleteMessage({ ...message, body: Buffer.from(String(seq)) })
      )
    )
    await done

    expect(maxRunning).toBe(getConcurrency(subscriber))
  })

  it('Should not redeliver messages that were successfully processed', async () => {
    const dfd = new Deferred()
    let handleCount = 0
    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['foo.bar'],
      handle: () => {
        handleCount++
        dfd.resolve()
      }
    }
    const message = getCompleteMessage({
      topic: 'foo.bar',
      body: Buffer.from('hi there')
    })

    const fileBackend1 = new FileBackend(path)
    handles.push(() => fileBackend1.close())
    await fileBackend1.subscribe(subscriber)
    await fileBackend1.publish(message)
    await dfd.promise

    const fileBackend2 = new FileBackend(path)
    handles.push(() => fileBackend2.close())
    await fileBackend2.subscribe(subscriber)

    expect(handleCount).toBe(1)
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
        handle: () => dlqSubscriberDfd.resolve()
      }
      const message = getCompleteMessage({
        topic: 'foo.bar',
        body: Buffer.from('hi there')
      })

      await fileBackend.subscribe(subscriber)

      if (currentlySubscribed) {
        await fileBackend.subscribe(dlqSubscriber)
      }

      await fileBackend.publish(message)
      await subscriberDfd.promise

      if (!currentlySubscribed) {
        await fileBackend.subscribe(dlqSubscriber)
      }

      await subscriberDfd.promise
    }
  )

  it.each([true, false])(
    'should only recover crashed messages (crashed: %p)',
    async (crashed) => {
      // chokidar uses nextTick() to fire the ready event
      jest.useFakeTimers({ doNotFake: ['nextTick'] })

      // Simulate a crashed process by creating a handler that never returns,
      // then shutting down the keepalive timer that updates the modtime of
      // the processing file
      const handlingDfd = new Deferred()
      const subscriber1: BackendSubscriber = {
        queueName: 'test',
        topics: ['foo.bar'],
        handle: () =>
          new Promise(() => {
            handlingDfd.resolve()
            // Never resolve
          })
      }
      const message = getCompleteMessage({
        topic: 'foo.bar',
        body: Buffer.from('hi there')
      })

      await fileBackend.subscribe(subscriber1)
      await fileBackend.publish(message)

      // Once this promise resolves, we know that the message is being handled
      await handlingDfd.promise
      const queuePath = resolve(
        getQueuePath(resolve(path, QUEUES_DIRECTORY), subscriber1.queueName),
        PROCESSING_DIRECTORY
      )
      const processingFile = (await readdir(queuePath))[0]

      // Kill the backend's timers so it no longer touches the file
      clearAllTimers()

      if (crashed) {
        // Make it look like the file hasn't been updated in a long time
        await utimes(
          resolve(queuePath, processingFile),
          new Date('2020-01-01'),
          new Date('2020-01-01')
        )
      }

      // Now prepare a new instance with a subscriber on that queue
      const messageDfd = new Deferred()
      const subscriber2: BackendSubscriber = {
        ...subscriber1,
        handle(message) {
          messageDfd.resolve(message)
        }
      }
      const fileBackend2 = new FileBackend(path)
      handles.push(() => fileBackend2.close())
      await fileBackend2.subscribe(subscriber2)

      // When we run the timers, it should see that the file is stale,
      // make it available for processing, then process it
      runOnlyPendingTimers()

      if (crashed) {
        expect(await messageDfd.promise).toMatchObject(message)
      } else {
        expect(await readdir(queuePath)).toEqual([processingFile])
      }
    }
  )

  it('should handle rebinding queues', async () => {
    const emitter = new EventEmitter()
    const testSubscription1: BackendSubscriber = {
      queueName: 'test',
      topics: ['test1'],
      handle({ topic }: Message) {
        emitter.emit(topic)
      }
    }
    const interval = setInterval(async () => {
      await fileBackend.publish(
        getCompleteMessage({
          topic: 'test1',
          body: Buffer.from('hi there'),
          properties: { id: `${Date.now()}-test1` }
        })
      )
      await fileBackend.publish(
        getCompleteMessage({
          topic: 'test2',
          body: Buffer.from('hi there'),
          properties: { id: `${Date.now()}-test2` }
        })
      )
    }, 50)
    await fileBackend.subscribe(testSubscription1)
    const fileBackend2 = new FileBackend(path)
    handles.push(
      () => fileBackend2.close(),
      () => clearInterval(interval)
    )

    // Wait until we see a message come through
    await new Promise((resolve) => emitter.once('test1', resolve))

    // This should stop (after a while) the messages from topic 1
    await fileBackend2.unbindQueue('test', ['test1'])
    await fileBackend2.bindQueue('test', ['test2'])

    // Wait until we see a message come through
    await new Promise((resolve) => emitter.once('test2', resolve))

    const messagesSeen: Record<string, number> = { test1: 0, test2: 0 }
    emitter.on('test1', () => messagesSeen.test1++)
    emitter.on('test2', () => messagesSeen.test2++)

    // Wait until we've seen a few messages into test2
    await new Promise<void>((resolve) =>
      emitter.on('test2', () => {
        if (messagesSeen.test2 >= 3) {
          resolve()
        }
      })
    )

    // Depending on exactly when the first FileBackend gets notified that the
    // subscription has changed, there may still be a message dispatched
    // to test1, but there should not be more than one message
    expect(messagesSeen.test1).not.toBeGreaterThan(1)
  })

  it('should handle queues being deleted', async () => {
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
    const fileBackend2 = new FileBackend(path)
    handles.push(() => fileBackend2.close())
    await fileBackend.subscribe(subscriber)
    await fileBackend2.subscribe(subscriber)
    const errors: unknown[] = []
    // Spam both backends with messages
    const messageSendInterval = setInterval(async () => {
      await Promise.all([
        fileBackend.publish(message),
        fileBackend2.publish(message)
      ])
    }, 0)
    let messageCount = 0
    let mostRecentMessageTime = Infinity
    emitter.on('message', () => (mostRecentMessageTime = Date.now()))
    handles.push(() => clearInterval(messageSendInterval))
    fileBackend.on('error', (error) => errors.push(error))
    fileBackend2.on('error', (error) => errors.push(error))

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
    await fileBackend.deleteQueue(subscriber.queueName)

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

  // it('should handle messages that were added before startup', async () => {})
  it('should handle multiple messages with the same ID', async () => {
    const message = getCompleteMessage({
      topic: 'test',
      body: Buffer.from('hi there')
    })
    const receivedMessages: Message<Buffer>[] = []
    const receivedMessagesDeferred = new Deferred()
    const subscriber: BackendSubscriber = {
      queueName: 'test',
      topics: ['test'],
      handle: (receivedMessage) => {
        receivedMessages.push(receivedMessage)

        if (receivedMessages.length === 2) {
          receivedMessagesDeferred.resolve(receivedMessages)
        }
      }
    }
    const fileBackend2 = new FileBackend(path)
    await fileBackend2.subscribe(subscriber)
    await fileBackend2.close()

    // Have to use a new instance because we can't guarantee when fileBackend
    // will receive notification that there's a new subscription
    const fileBackend3 = new FileBackend(path)
    handles.push(() => fileBackend3.close())
    await fileBackend3.ready
    await fileBackend3.publish(message)
    await fileBackend3.publish(message)
    await fileBackend3.subscribe(subscriber)

    expect(await receivedMessagesDeferred.promise).toMatchObject([
      message,
      message
    ])
  })

  it.todo('message processing stress test')
})
