import assert from 'assert'
import PromiseQueue from 'promise-queue'
import { Deferred } from 'ts-deferred'
import { Message, Middleware, Subscriber } from '../types'
import { createMessage, getCompleteMessage } from '../util'

export interface BatchArgs {
  /** The maximum amount of time to wait before processing a batch */
  maxTime: number
  /** The maximum number of messages a batch can contain */
  maxMessages: number
}

/**
 * Batches messages together so that they can be processed at one time. The
 * subscriber will receive each batch as a single message with the batched
 * messages in the body
 */
export const batch: (args: BatchArgs) => Middleware =
  ({ maxTime, maxMessages }) =>
  ({ announce, addSubscribeMiddleware }) => {
    addSubscribeMiddleware(async ({ subscriber, next }) => {
      const concurrency = subscriber.options?.concurrency ?? 1
      // We use a promise queue to ensure we never exceed the handler's
      // declared concurrency
      const promiseQueue = new PromiseQueue(concurrency)
      let batch: Batch | undefined

      await next(getNextSubscriber())

      function getNextSubscriber(): Subscriber {
        return {
          ...subscriber,
          options: {
            ...subscriber.options,
            // We add 1 so we can keep collecting messages while the subscriber
            // is processing
            concurrency: (concurrency + 1) * maxMessages
          },
          handle
        }
      }

      async function handle(message: Message): Promise<unknown> {
        if (!batch) {
          batch = {
            deferred: new Deferred(),
            timeout: setTimeout(processBatch, maxTime),
            messages: []
          }
        }

        const promise = batch.deferred.promise
        batch.messages.push(message)

        if (batch.messages.length >= maxMessages) {
          processBatch()
        }

        return promise
      }

      function processBatch() {
        assert(batch)
        const { timeout, messages, deferred } = batch
        batch = undefined

        clearTimeout(timeout)

        promiseQueue
          .add(async () =>
            subscriber.handle(
              getCompleteMessage(
                createMessage(
                  messages[0].topic,
                  messages,
                  {},
                  { date: messages[0].properties.date }
                )
              ),
              {
                announce
              }
            )
          )
          .then(deferred.resolve, deferred.reject)
      }
    })
  }

interface Batch {
  timeout: NodeJS.Timeout
  messages: Message[]
  deferred: Deferred<unknown>
}
