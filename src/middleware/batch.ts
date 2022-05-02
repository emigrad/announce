import PromiseQueue from 'promise-queue'
import { Deferred } from 'ts-deferred'
import { Message, Middleware } from '../types'
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
  (announce) => {
    return {
      async subscribe({ subscriber, next }): Promise<void> {
        const concurrency = subscriber.options?.concurrency ?? 1
        // We use a promise queue to ensure we never exceed the handler's
        // declared concurrency
        const promiseQueue = new PromiseQueue(concurrency)
        let batchTimeout: NodeJS.Timeout | undefined
        let batchMessages: Message<any>[] | undefined
        let batchDeferred: Deferred<unknown> | undefined

        await next({
          ...subscriber,
          options: {
            ...subscriber.options,
            // We add 1 so we can keep collecting messages while the subscriber
            // is processing
            concurrency: (concurrency + 1) * maxMessages
          },
          handle(message) {
            if (!batchDeferred) {
              batchDeferred = new Deferred()
              batchTimeout = setTimeout(processBatch, maxTime)
              batchMessages = []
            }

            const promise = batchDeferred.promise
            batchMessages!.push(message)

            if (batchMessages!.length >= maxMessages) {
              processBatch()
            }

            return promise
          }
        })

        function processBatch() {
          const messages = batchMessages!
          const deferred = batchDeferred!
          clearTimeout(batchTimeout!)

          batchDeferred = undefined
          batchMessages = undefined
          batchTimeout = undefined

          promiseQueue
            .add(() =>
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
      }
    }
  }
