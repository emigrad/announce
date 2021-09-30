import { Message, SubscriberWrapper } from '../types'
import { createMiddleware } from '../util'

export interface DelayArgs {
  /** How many milliseconds to delay messages by */
  delay: number

  /**
   * The random variation in delay, as a multiple of delay. For example
   * if delay is 50 and variation is 0.5, the actual delay for each message
   * will be between 25 and 75ms. Defaults to 0
   */
  variation?: number
}

export const withDelay: SubscriberWrapper<[DelayArgs], any> = (
  subscriber,
  { delay: delayMs, variation = 0 }
) => {
  const timers: Set<NodeJS.Timer> = new Set()
  const rejects: Set<(...args: any[]) => any> = new Set()
  let registeredClose = false

  return {
    ...subscriber,
    async handle(message, args) {
      if (!registeredClose) {
        args.announce.on('close', shutdown)
        registeredClose = true
      }

      await wait(getDelay(message))

      return subscriber.handle(message, args)
    }
  }

  /**
   * Returns a promise that's resolved after the given delay, or rejects
   * it if the announce instance is closed before the requested amount
   * of time has elapsed
   */
  function wait(delay: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        rejects.delete(reject)
        resolve()
      }, delay)
      timers.add(timer)
      rejects.add(reject)
    })
  }

  /**
   * Returns how long we should wait before processing the given message,
   * taking into account the amount of time that has elapsed between it
   * being sent and us receiving it
   */
  function getDelay(message: Message<any>): number {
    const elapsed = Date.now() - +message.properties.date
    const actualDelay = Math.max(
      0,
      delayMs + (Math.random() - 0.5) * variation * delayMs
    )

    return Math.max(0, actualDelay - elapsed)
  }

  function shutdown() {
    const error = new Error('Announce instance has shut down')

    timers.forEach((timer) => clearTimeout(timer))
    rejects.forEach((reject) => reject(error))
  }
}

/**
 * Waits until at least delayMs milliseconds since the message was published
 * before handling each message.
 */
export const delay = createMiddleware(withDelay)
