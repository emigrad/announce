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
    const announce = new Announce('memory://')
    const initialDelay = 4000
    const increaseFactor = 5
    const variation = 0.2
    const maxRetries = 5

    announce.use(retry({ initialDelay, increaseFactor, variation, maxRetries }))
    await announce.subscribe({
      name: 'test',
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
    const spyDfd = new Deferred<any>()
    const handleDfd = new Deferred<Message<any>>()
    const announce = new Announce('memory://')
    announce.use(
      retry(),
      spy({ onHandle: spyDfd.resolve, onHandleError: spyDfd.reject })
    )
    await announce.subscribe({
      name: 'test',
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
    const receivedMessages: Message<any>[] = []
    const spyDfd = new Deferred<void>()
    const announce = new Announce('memory://')
    const error = new Error('Oh no')
    announce.use(
      retry({ maxRetries }),
      spy({ onHandleError: ({ error }) => spyDfd.resolve(error) })
    )
    await announce.subscribe({
      name: 'test',
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
    const spyDfd = new Deferred<any>()
    const announce = new Announce('memory://')
    const canRetry = jest.fn().mockReturnValue(false)
    const receivedMessages: Message<any>[] = []
    const error = new Error()
    announce.use(
      retry({ canRetry }),
      spy({ onHandleError: ({ error }) => spyDfd.resolve(error) })
    )
    await announce.subscribe({
      name: 'test',
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
    const announce = new Announce('memory://')
    const subscribers: Subscriber<any>[] = []

    announce.use(
      retry(),
      spy({ onSubscribe: ({ subscriber }) => subscribers.push(subscriber) })
    )
    const subscriber1: Subscriber<any> = {
      name: 'test',
      topics: ['test'],
      handle: () => {},
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
    const receivedMessages: Message<any>[] = []
    const retryMessages: Message<any>[] = []
    const spyDfd = new Deferred<void>()
    const announce = new Announce('memory://')
    announce.use(
      retry(),
      spy({
        onHandle: ({ message }) => {
          if (message.topic.includes('retry')) {
            retryMessages.push(message)
            if (retryMessages.length >= 2) {
              spyDfd.resolve()
            }
          }
        }
      })
    )
    await announce.subscribe({
      name: 'test',
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
