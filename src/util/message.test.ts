import { Subscriber } from '../types'
import {
  createMessage,
  getCompleteMessage,
  getDeadLetterQueue,
  hasDeadLetterQueue
} from './message'

describe('Message utils', () => {
  const topic = 'fred'
  const body = { hi: 'there' }
  const headers = { 'Content-Type': 'blah' }
  const properties = { id: '123', date: new Date() }
  const subscriber: Subscriber<any> = {
    queueName: 'blah',
    topics: ['*'],
    handle: () => {}
  }

  test('createMessage()', () => {
    expect(createMessage(topic, body)).toEqual({
      topic,
      body,
      headers: {},
      properties: {}
    })

    expect(createMessage(topic, body, headers, properties)).toEqual({
      topic,
      body,
      headers,
      properties
    })
  })

  test('getCompleteMessage()', () => {
    expect(getCompleteMessage({ topic, body }).headers).toEqual({})
    expect(
      getCompleteMessage({ topic, body, headers, properties })
    ).toMatchObject({
      topic,
      body,
      headers,
      properties
    })
    expect(getCompleteMessage({ topic, body }).properties.id).toBeDefined()
    expect(getCompleteMessage({ topic, body }).properties.date).toBeInstanceOf(
      Date
    )
  })

  test.each([true, false, undefined])('hasDeadLetterQueue() (%p)', (value) => {
    const expected = value ?? true

    expect(
      hasDeadLetterQueue({ ...subscriber, options: { deadLetterQueue: value } })
    ).toBe(expected)
  })

  test.each([true, false, undefined])('getDeadLetterQueue() (%p)', (value) => {
    const expected = value ?? true ? '~dlq-' + subscriber.queueName : null

    expect(
      getDeadLetterQueue({ ...subscriber, options: { deadLetterQueue: value } })
    ).toBe(expected)
  })
})
