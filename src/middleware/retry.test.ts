import { Deferred } from 'ts-deferred'
import { Announce } from '../Announce'
import { Message, Subscriber } from '../types'
import { createMessage, getCompleteMessage } from '../util'
import * as delay from './delay'
import { retry } from './retry'
import { spy } from './spy'

jest.mock('./delay')

describe('retry middleware', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest
      .spyOn(delay, 'withDelay')
      .mockImplementation((subscriber) => subscriber)
  })

  it('Should set up retry queues', async () => {
    const announce = new Announce({ url: 'memory://' })
    const initialDelay = 4000
    const increaseFactor = 5
    const variation = 0.2
    const maxRetries = 5

    announce.use(retry({ initialDelay, increaseFactor, variation, maxRetries }))
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle: jest.fn()
    })

    for (let retryNum = 0; retryNum < maxRetries; retryNum++) {
      expect(delay.withDelay).toHaveBeenCalledWith(expect.anything(), {
        delay: initialDelay * Math.pow(increaseFactor, retryNum),
        variation
      })
    }
  })

  it('Should not retry successful messages', async () => {
    const spyDfd = new Deferred()
    const handleDfd = new Deferred<Message>()
    const announce = new Announce({ url: 'memory://' })
    announce.use(
      spy({ onHandle: spyDfd.resolve, onHandleError: spyDfd.reject }),
      retry()
    )
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle: handleDfd.resolve
    })
    jest.spyOn(announce, 'publish')

    await announce.publish(createMessage('test', Buffer.from('')))
    await handleDfd.promise
    await spyDfd.promise

    expect(announce.publish).toHaveBeenCalledTimes(1)
  })

  it('Should retry failed messages up to maxRetries', async () => {
    const maxRetries = 2
    const receivedMessages: Message[] = []
    const spyDfd = new Deferred<unknown>()
    const announce = new Announce({ url: 'memory://' })
    const error = new Error('Oh no')
    announce.use(
      spy({ onHandleError: ({ error }) => spyDfd.resolve(error) }),
      retry({ maxRetries })
    )
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle(message) {
        receivedMessages.push(message)
        throw error
      }
    })

    await announce.publish(createMessage('test', Buffer.from('')))

    expect(await spyDfd.promise).toBe(error)
    expect(receivedMessages.length).toBe(maxRetries + 1)
    expect(receivedMessages.every(({ topic }) => topic === 'test'))
  })

  it('Should not retry failures if canRetry() returns false', async () => {
    const spyDfd = new Deferred()
    const announce = new Announce({ url: 'memory://' })
    const canRetry = jest.fn().mockReturnValue(false)
    const receivedMessages: Message[] = []
    const error = new Error()
    announce.use(
      spy({ onHandleError: ({ error }) => spyDfd.resolve(error) }),
      retry({ canRetry })
    )
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      handle: (message) => {
        receivedMessages.push(message)
        throw error
      }
    })

    await announce.publish(createMessage('test', Buffer.from('')))

    expect(await spyDfd.promise).toBe(error)
    expect(receivedMessages.length).toBe(1)
  })

  it('Should not subscribe to the retry queues multiple times for equivalent subscribers', async () => {
    const announce = new Announce({ url: 'memory://' })
    const subscribers: Subscriber[] = []

    announce.use(
      spy({ onSubscribe: ({ subscriber }) => subscribers.push(subscriber) }),
      retry()
    )
    const subscriber1: Subscriber = {
      queueName: 'test',
      topics: ['test'],
      handle: doNothing,
      options: {
        concurrency: 1
      }
    }
    const subscriber2 = { ...subscriber1, options: { concurrency: 2 } }

    await announce.subscribe(subscriber1)

    const originalSubscribers = [...subscribers]
    await announce.subscribe(subscriber2)

    expect(subscribers.length).toEqual(originalSubscribers.length + 1)
  })

  it('Should set the current date when publishing messages to the delay queues', async () => {
    const messageDate = new Date()
    const receivedMessages: Message[] = []
    const retryMessages: Message[] = []
    const spyDfd = new Deferred<void>()
    const announce = new Announce({ url: 'memory://' })
    announce.use(
      spy({
        onHandle: ({ message }) => {
          if (message.topic.includes('retry')) {
            retryMessages.push(message)
            if (retryMessages.length >= 2) {
              spyDfd.resolve()
            }
          }
        }
      }),
      retry()
    )
    await announce.subscribe({
      queueName: 'test',
      topics: ['test'],
      async handle(message) {
        receivedMessages.push(message)
        return new Promise((_, reject) => setTimeout(reject, 10))
      }
    })

    await announce.publish(
      getCompleteMessage({
        topic: 'test',
        body: Buffer.from(''),
        properties: { date: messageDate }
      })
    )
    await spyDfd.promise

    receivedMessages.forEach((message) => {
      expect(message.properties.date).toEqual(messageDate)
    })
    retryMessages.forEach((message) => {
      expect(+message.properties.date).toBeGreaterThan(+messageDate)
    })
  })
})

function doNothing() {
  // Do nothing
}
