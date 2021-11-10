import { Subscriber } from '../types'
import {
  createMessage,
  getCompleteMessage,
  getDeadLetterTopic,
  hasDeadLetterTopic
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
      hasDeadLetterTopic({
        ...subscriber,
        options: { preserveRejectedMessages: value }
      })
    ).toBe(expected)
  })

  test.each([true, false, undefined])('getDeadLetterQueue() (%p)', (value) => {
    const expected = value ?? true ? '~rejected-' + subscriber.queueName : null

    expect(
      getDeadLetterTopic({
        ...subscriber,
        options: { preserveRejectedMessages: value }
      })
    ).toBe(expected)
  })
})
