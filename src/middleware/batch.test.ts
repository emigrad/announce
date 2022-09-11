import { Announce } from '../Announce'
import { Message } from '../types'
import { createMessage } from '../util'
import { batch } from './batch'
import { spy } from './spy'

jest.useFakeTimers()

describe('batch', () => {
  const maxMessages = 3
  const maxTime = 5000
  let announce: Announce
  let receivedBatches: Message<Message<Buffer>[]>[]
  let acknowledgedMessages: Message<Buffer>[]
  let rejectedMessages: Message<Buffer>[]

  beforeEach(async () => {
    const concurrency = 2

    receivedBatches = []
    acknowledgedMessages = []
    rejectedMessages = []
    announce = new Announce({ url: 'memory://' }).use(
      spy({
        onHandle: ({ message }) =>
          acknowledgedMessages.push(message as Message<Buffer>),
        onHandleError: ({ message }) =>
          rejectedMessages.push(message as Message<Buffer>),
        onSubscribe: ({ subscriber }) => {
          if (subscriber.queueName === 'test') {
            expect(subscriber.options?.concurrency).toBe(
              (concurrency + 1) * maxMessages
            )
          }
        }
      }),
      batch({ maxMessages, maxTime })
    )

    await announce.subscribe({
      topics: ['test'],
      queueName: 'test',
      handle: (message: Message<Message<Buffer>[]>) => {
        receivedBatches.push(message)
      },
      options: { concurrency }
    })
  })

  afterEach(() => {
    jest.clearAllTimers()
  })

  it('should batch messages into maxMessages', async () => {
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < maxMessages - 1; i++) {
        await announce.publish(createMessage('test', Buffer.from('1234')))
      }
      await Promise.resolve()

      expect(receivedBatches).toHaveLength(batch)
      expect(acknowledgedMessages).toHaveLength(batch * maxMessages)

      await announce.publish(createMessage('test', Buffer.from('1234')))
      await Promise.resolve()

      expect(receivedBatches).toHaveLength(batch + 1)
      expect(acknowledgedMessages).toHaveLength((batch + 1) * maxMessages)
      expect(receivedBatches[batch]).toMatchObject({
        topic: 'test',
        body: acknowledgedMessages.slice(batch * maxMessages)
      })
    }
  })

  it('should forward messages once the time has elapsed', async () => {
    for (let i = 0; i < 3; i++) {
      await announce.publish(createMessage('test', Buffer.from('1234')))

      await Promise.resolve()
      expect(receivedBatches).toHaveLength(i)

      jest.advanceTimersByTime(maxTime)
      expect(receivedBatches).toHaveLength(i + 1)
    }
  })

  it('should reject all messages in the batch if processing fails', async () => {
    const error = new Error('Oh no')
    await announce.subscribe({
      topics: ['test2'],
      queueName: 'test2',
      handle: () => {
        throw error
      }
    })

    for (let i = 0; i < maxMessages; i++) {
      await announce.publish(createMessage('test2', Buffer.from('1234')))
    }

    await Promise.resolve()

    expect(rejectedMessages).toHaveLength(maxMessages)
  })
})
