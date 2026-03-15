# Announce

Announce is a robust library for implementing the publish/subscribe pattern in your applications. It is simple to use, easily extensible, and encourages patterns that will help keep your code clean and testable.

Announce can run locally using a file or in-memory store, or can be backed by an external message broker such as RabbitMQ.

Not sure what this library is really for? Jump down to the [What problems does this solve?](#what-problems-does-this-solve) section below.

## Installation

```shell
yarn add @emigrad/announce
```

## Usage

Set the `ANNOUNCE_BACKEND_URL` environment variable to point to your backend. For local testing, `memory://` will work fine - see the [Backends](#Backends) section for other options.

If you're using [dotenv](https://www.npmjs.com/package/dotenv) or [dotenv-flow](https://www.npmjs.com/package/dotenv-flow), you can add this line to your `.env` file:

```.dotenv
ANNOUNCE_BACKEND_URL=memory://
```

Then in your application, create a new Announce instance. In most cases you don't need any arguments:

```typescript
import { Announce } from '@emigrad/announce'

const announce = new Announce()
```

While we recommend that you let Announce read the backend URL from the environment variable, you can also specify it directly if needed by providing it as the first parameter instead: `new Announce({url: 'memory://'})`

An announce instance starts out as a blank slate - messages are sent and received directly to the backend, and only instances of `Buffer` can be used. We can make it much more useful by adding some middleware:

```typescript
// Add this at the top of the file
import { Announce, log, json } from '@emigrad/announce'

const announce = new Announce()

// If you have a logger with a Winston-like API, you can
// have announce log the messages it sends and receives
announce.use(log({ logger }))

// This allows us to send and receive any objects that can be serialised to JSON
announce.use(json())
```

`logger` can be any logger that supports standard NPM log levels and accepts objects as log entries - this includes [Winston](https://www.npmjs.com/package/winston), [Bunyan](https://www.npmjs.com/package/bunyan) and [Pino](https://www.npmjs.com/package/pino). Now we have an instance that automatically serialises and deserialises to JSON, and logs any errors that occur.

There are a number of other in-built middlewares you can add; they're listed in the [Using middleware](#using-middleware) section below.

# What problems does this solve?

In most applications, there are many situations where things need to happen, but they don't need to happen _right now_. An example is email notifications: let's say someone adds a comment to your blog post. You would like to receive a notification about it, but whether it happens now or in 5 seconds' time doesn't really matter. In these situations, rather than have the `addComment()` function directly call `sendEmail()`, it's usually better for `addComment()` to simply announce to the rest of the application that a comment was added to the post, and let the other parts of the code respond to that event (or not) as needed.

Think of it like a traffic report. Each morning, the radio presenters announce where the traffic jams are. Each driver is then able to tune in if they want to, and adjust their route or take some other action based on the information they receive. This is immensely simpler than having the presenters call each individual driver and telling them what to do.

## Advantages of the publish/subscribe pattern

Here are some of the gains you can get from designing your application in this way:

### Reduced coupling

According to the [Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle), each module, class and function should be responsible for only one thing. The `addComment()` function should not have to be concerned with sending emails or push notifications, updating analytics, maintaining backlinks, or anything else not directly related to adding a comment. By using the publish/subscribe pattern, `addComment()` only has to do two things: call `saveComment()` and `announceComment()`

### Increased resilience

If `addComment()` is responsible for calling `sendEmail()`, then it needs to handle tricky edge cases, such as the email server being unavailable, or the analytics system returning an error. What should the code do if emailing succeeds but updating the analytics fails, or vice versa? By announcing the event instead, `addComment()` only has two failure scenarios to deal with: an error writing to the database and an error announcing the comment. This makes the code much simpler and easer to understand, with fewer untested edge cases.

Since sending emails and updating the analytics is now triggered by an event, it's now much easier to handle temporary failures of those services - we can reprocess the failed events. Failures in a system are much less likely to cause problems elsewhere.

### Increased perceived performance

Since we only need to wait for the message broker to accept an event, not for the listeners to process it, we are able to respond much faster. This makes our user interface feel faster and more responsive.

### Easier to test

By reducing the responsibilities of a piece of code, we make it easier to test. There are fewer edge cases we need to cover, fewer dependencies to mock or set up, and we're far more able to think about and test each module as an isolated system

### Easier to refactor

Due to the reduced coupling, there are far fewer cross-module references in the code. It's no longer necessary to update or re-test the comment system when the email system changes. This makes development a few more pleasant experience.

## Disadvantages of the publish/subscribe pattern

Let's be honest: nothing comes for free. There are a few reasons you might _not_ want to use this pattern in your application:

### Initial learning curve

It may take some time to learn how to effectively use this pattern in your applications.

### Possible overkill for small applications

If your application is small, you may decide that it is simpler to call functions or make [RPCs](https://en.wikipedia.org/wiki/Remote_procedure_call) directly. You can always start using publish/subscribe later if you choose.

### Additional cost

If your application runs on more than one node (for example in [Kubernetes](https://en.wikipedia.org/wiki/Kubernetes)), you'll usually need an external message broker. This adds some cost to running your application, either in time if you manage it yourself, or money if you use a hosted service like [Amazon MQ](https://aws.amazon.com/amazon-mq).

If you're only planning to run a single instance of your application (for example on a [Digital Ocean](https://digitalocean.com) droplet), in many cases you can avoid this by using a [File backend](#file-backend) instead.

# Use cases

Here are some common use cases for the publish/subscribe pattern. Many of these can be combined for powerful results.

## Emails and push notifications

When something happens in your application (a comment is added, a user signs up, an order is placed), publish an event and let a separate subscriber handle sending the email or push notification. This keeps your business logic clean and makes it easy to change what notifications are sent without modifying the original code.

```typescript
// In your comment service
await announce.publish({ topic: 'comment.created', body: { postId, commentId, authorId } })

// In a separate notification module
await announce.subscribe({
  queueName: 'comment-email-notifications',
  topics: ['comment.created'],
  async handle(message) {
    const post = await getPost(message.body.postId)
    await sendEmail(post.authorEmail, 'New comment on your post', ...)
  }
})
```

It is a good practice to send one message per email, so that users don't receive duplicate emails due to unrelated failures in other message handlers.

## Batch processing

Use the `batch()` middleware to group messages together before processing them. This is ideal for situations where it's more efficient to process items in bulk, such as database writes, API calls, or report generation.

## Job systems

Announce can be used as a simple job processing system. Publish a message describing the job, and a subscriber picks it up and processes it. With the `retry()` middleware, failed jobs are automatically retried. With multiple application instances connected to RabbitMQ, jobs are automatically distributed across workers.

## Cache invalidation

### Direct invalidation

Publish an event when data changes and subscribe to it in your caching layer to invalidate the affected cache entries directly.

```typescript
await announce.subscribe({
  queueName: 'user-cache-invalidation',
  topics: ['user.*'],
  async handle(message) {
    await cache.delete(`user:${message.body.userId}`)
  }
})
```

### Indirect invalidation

When the data you need to invalidate depends on other data, listen for those upstream changes. For example, if a user's display name changes, invalidate the cache for all posts authored by that user.

## Webhooks

### Receiving events

When your application receives a webhook from an external service, publish it as a message. This decouples your webhook endpoint from the code that processes the event, and gives you the benefits of retries and dead letter queues.

### Sending events

Subscribe to internal events and forward them as webhooks to external services.

## Perform an action after things _stop_ happening

Use the `delay()` middleware to wait before acting on an event. If another event arrives before the delay expires, the timer resets. This is useful for sending a summary email after a burst of activity, or debouncing rapid changes.

## Live query updates

Publish events when data changes and subscribe to them on behalf of connected clients to push real-time updates via WebSockets or Server-Sent Events.

## Soft start

Use the `subscriptionFilter()` middleware when starting your application to control which subscribers are active. This allows you to gradually enable functionality, or to run specialised instances that only process certain types of work.

# Concepts

## Message

A message is sent by publishers and is received by interested subscribers. It has a single topic and can contain any data. For example, a message about a user changing their email address might have a topic of `user.changed` and contain the user's old and new email addresses in the body.

Each message will be added to the queues of all the subscribers that have a matching topic. This means that each message will be processed by all of the subscribers that are interested in it.

## Topic

A message's topic represents what a message is about. Topics are usually organised in a hierarchy, with levels separated by a period. For example, you may have the topics `user.created`, `user.changed`, and `organization.membership.changed`, where messages pertaining to users all have topics starting with `user.`, messages relating to an organisation have topics that start with `organization.` and messages relating to an organisation's memberships start with `organization.membership.`.

Subscribers can subscribe to any number of topics, and `*` acts as a wildcard, matching any number of characters. For example, a subscriber that listens to the topics `user.created` and `organization.membership.*` will receive messages with the topics `user.created` and `organization.membership.created`, but not `organization.created`.

In many cases, messages are sent in response to an event that has occurred (for example a user signing up), and thus topics are usually expressed as past tense (eg `user.created` instead of `user.create`). This is just a recommendation however, you are free to define your topics however you wish.

## Subscriber

A subscriber has a queue, a set of topics it listens to, and a function to handle messages that match the set of topics. Each matching message will be added to the subscriber's queue, and will be processed by one of the subscribers of that queue.

Each subscriber should use a unique queue. Since each message in a queue is delivered once, having multiple subscribers sharing the same queue will result in each subscriber only seeing some of the messages.

## Queue

Each subscriber has a queue into which matching messages are placed. Messages are processed in the order in which they're added to the queue. A message is removed from queue once it has either been successfully processed by a subscriber, or it has been rejected by the subscriber's handler throwing an Error.

When using Announce with an external broker such as RabbitMQ, queues will continue to receive messages even if there are no active subscribers. These messages will be processed as soon as the subscriber is re-added. For the internal backends InMemory and File, only messages sent after the subscriber has been added will be received.

## Dead letter queues and topics

By default, supporting backends will republish rejected messages to the dead letter topic, which will add them to the dead letter queue `~rejected-<subscriber-queue-name>`. This is to enable debugging and reprocessing of failed messages. You can prevent rejected messages from being preserved by adding `options: { preserveRejectedMessages: false }` to the subscriber.

In general it's recommended that all processing of rejected messages be done by either the subscriber or middleware, however there may be instances where you want to add a subscriber to the dead letter topic. If you had the subscriber:

```typescript
import { Subscriber } from './Subscriber'

const failingSubscriber: Subscriber = {
  queueName: 'example',
  topics: ['example'],
  handle() {
    throw new Error('Not today')
  }
}
```

You can subscribe to its rejected messages by creating another subscriber:

```typescript
import { getDeadLetterTopic } from './message'
import { Subscriber } from './Subscriber'

const rejectedMessageSubscriber: Subscriber = {
  queueName: 'rejected-messages',
  topics: [getDeadLetterTopic(failingSubscriber)],
  handle() {
    // ...
  }
}
```

In this way, `rejectedMessageSubscriber` will receive every message that `failingSubscriber` rejects, but a copy of those messages will still be preserved in the dead letter queue.

It is not recommended, but you can also consume those messages directly if needed, by setting the queueName as `getDeadLetterQueueName(failingSubscriber)`, like so:

```typescript
import { getDeadLetterQueueName, getDeadLetterTopic } from './message'
import { Subscriber } from './Subscriber'

const rejectedMessageSubscriber: Subscriber = {
  queueName: getDeadLetterQueueName(failingSubscriber),
  topics: [getDeadLetterTopic(failingSubscriber)],
  handle() {
    // ...
  }
}
```

Doing this means that the rejected messages will not be preserved.

# API

## `new Announce(args?)`

Creates a new Announce instance.

- `args.url` (optional): The backend URL. If not provided, the `ANNOUNCE_BACKEND_URL` environment variable is used. Supported schemes: `memory://`, `file://`, `amqp://`, `amqps://`.
- `args.backendFactory` (optional): A custom factory function for creating backends. This is primarily useful for testing.

```typescript
// Use the ANNOUNCE_BACKEND_URL environment variable
const announce = new Announce()

// Or provide a URL directly
const announce = new Announce({ url: 'memory://' })
```

## `announce.use(...middlewares)`

Adds one or more middlewares to the instance. Middlewares are applied to all subsequent `subscribe()`, `publish()` and `destroyQueue()` calls. Returns the instance for chaining.

```typescript
announce.use(json(), log({ logger }), retry())
```

## `announce.with(...middlewares)`

Returns a copy of the Announce instance with the given middlewares added. The original instance is not modified. Use this when you want middleware to apply only to certain subscribers or publish calls.

```typescript
const delayedAnnounce = announce.with(delay({ delay: 5000 }))
await delayedAnnounce.subscribe(mySubscriber) // only this subscriber is delayed
```

## `announce.subscribe(...subscribers)`

Adds one or more subscribers. Each subscriber must have:

- `queueName` (string): A globally unique name for this subscriber's queue.
- `topics` (string[]): The topic patterns to listen to. Supports `*` (matches one level) and `**` (matches zero or more levels).
- `handle(message, { announce })` (function): The function that processes each message. Throw an error to reject the message.
- `options.concurrency` (number, optional): How many messages can be processed simultaneously. Default: `1`.
- `options.preserveRejectedMessages` (boolean, optional): Whether to preserve rejected messages in a dead letter queue. Default: `true`.

```typescript
await announce.subscribe({
  queueName: 'send-welcome-emails',
  topics: ['user.created'],
  async handle(message, { announce }) {
    await sendWelcomeEmail(message.body.email)
  }
})
```

## `announce.publish(...messages)`

Publishes one or more messages. Returns a promise that resolves with an array of the completed messages (with `id` and `date` filled in).

Each message must have:

- `topic` (string): The message's topic, as a dotted string (eg `user.created`).
- `body` (any): The message payload. Must be a `Buffer` unless the `json()` middleware is used.
- `headers` (object, optional): Application-specific headers.
- `properties` (object, optional): Message metadata. `id` and `date` are auto-generated if not provided.

```typescript
const [message] = await announce.publish({
  topic: 'user.created',
  body: { id: 123, email: 'user@example.com' }
})

console.log(message.properties.id)   // auto-generated unique ID
console.log(message.properties.date) // auto-generated Date
```

## `announce.destroyQueue(queueName)`

Destroys the named queue, removing any unprocessed messages.

## `announce.close()`

Closes the Announce instance and its connection to the backend. Returns a promise that resolves when the connection is closed. Emits a `'close'` event.

## `announce.destroy(err?)`

Closes the Announce instance, optionally emitting the given error before closing.

# Error handling

Announce handles errors at several levels:

## Handler errors

When a subscriber's `handle()` function throws an error, the message is _rejected_. By default, rejected messages are republished to a dead letter queue (see [Dead letter queues and topics](#dead-letter-queues-and-topics)). You can use the `retry()` middleware to automatically retry failed messages before they are rejected.

## Publish errors

If a message cannot be published (for example because the backend is unavailable), the promise returned by `publish()` will reject.

## Backend errors

If the backend encounters an unrecoverable error (such as the RabbitMQ connection being lost), it emits an `'error'` event on the Announce instance and then closes the connection. You can listen for this event:

```typescript
announce.on('error', (err) => {
  console.error('Announce error:', err)
})
```

## Subscriber error isolation

An error in one subscriber does not affect other subscribers. If the email notification subscriber fails, the analytics subscriber will continue to process its messages independently.

# Using middleware

Announce provides a very powerful middleware system, in fact almost all of Announce's capabilities are provided through middleware. This section covers the middleware that is provided by Announce itself; see [Writing middleware](#writing-middleware) below for details on how you can create your own.

A default `announce` instance provides an extremely minimal interface to the backend, so in almost all cases you will want to add some middleware to enhance its functionality.

There are two ways to add middleware, `use()` and `with()`. In most cases you should use `use()`, since that installs the middleware globally. Use `with()` when you want the middleware to only be active for certain subscribers, or when publishing certain messages.

## use()

Call this function to add the middleware globally. It will affect all future subscribers and calls to `publish()`. Any subscribers that were added _prior_ to calling `use()` will not be affected.

```javascript
const announce = new Announce()

// All subscribers added after this point will have JSON-formatted messages
// automatically deserialised for them
announce.use(json())
```

## with()

Call this function to add the middleware for specific subscribers. It returns a clone of the Announce instance, and only the returned copy will have the middleware applied - the original instance is unchanged.

```javascript
const announce = new Announce()

// Both subscribers will have JSON-formatted messages deserialised for them
announce.use(json())

const delayedAnnounce = announce.with(delay({ delay: 1000 }))

// Since this subscriber was subscribed using the original announce instance,
// its messages will not be delayed
await announce.subscribe({
  queueName: 'subscriber1',
  topics: ['topic1'],
  handle: () => {}
})

// This subscriber was subscribed using delayedAnnounce, so it will receive
// its messages one second after they were sent.
await delayedAnnounce.subscribe({
  queueName: 'subscriber2',
  topics: ['topic2'],
  handle: () => {}
})
```

## Middleware order

The order that middleware is added is important - middlewares added earlier sit closer to the backend. You can visualise the middleware as a stack sitting on top of the backend.

When publishing a message, the most recently-added middleware processes the message, and passes it on to next-most recently added, and so on, until the first-added middleware passes it to the backend. When receiving a message, the opposite is true - the first-added middleware processes the message, then passes it on to the next-added middleware, until it reaches the most recently-added middleware and finally the queue's handler.

This means that you should generally add "low-level" middleware like `json()` before than higher-level middleware like `log()`, so that log() is able to log the deserialised contents of the messages. If `log()` is added before `json()`, it would be closer to the backend and only the serialised `Buffer` instances.

# Middlewares

This is a list of the middlewares provided by Announce. See [Writing middleware](#writing-middleware) below for details on how to write your own

## batch()

`batch()` groups incoming messages together and delivers them to the subscriber as a single message whose body is an array of the batched messages. A batch is processed when it reaches `maxMessages` messages, or when `maxTime` milliseconds have elapsed since the first message in the batch arrived, whichever comes first.

This is useful when it's more efficient to process items in bulk - for example, writing multiple records to a database in one query, or sending a summary email instead of many individual ones.

### Options

- `maxTime` (required): The maximum amount of time (in milliseconds) to wait before processing a batch.
- `maxMessages` (required): The maximum number of messages a batch can contain.

```typescript
announce.use(batch({ maxTime: 5000, maxMessages: 100 }))

await announce.subscribe({
  queueName: 'bulk-insert',
  topics: ['record.created'],
  async handle(message) {
    // message.body is an array of the original messages
    const records = message.body.map(m => m.body)
    await db.bulkInsert(records)
  }
})
```

Source: [batch.ts](./src/middleware/batch.ts)

## delay()

`delay()` delays the processing of messages. This can be useful when Announce is being used as a job-processing system, or to wait until something has stopped happening before acting. For example the application may wish to email a summary of a conversation or series of actions to avoid spamming users.

The delay is measured from when the message was _published_, not from when it was received. This means that if a message takes 3 seconds to reach the subscriber and the delay is 5 seconds, the subscriber will only wait an additional 2 seconds before processing the message.

### Options

- `delay` (required): How many milliseconds to delay messages by.
- `variation` (number, optional): The random variation in delay, as a multiple of `delay`. For example, if `delay` is 50 and `variation` is 0.5, the actual delay for each message will be between 25ms and 75ms. Default: `0`.

```typescript
const delayedAnnounce = announce.with(delay({ delay: 5000 }))

await delayedAnnounce.subscribe({
  queueName: 'delayed-summary',
  topics: ['activity.*'],
  async handle(message) {
    await sendActivitySummary(message.body)
  }
})
```

Source: [delay.ts](./src/middleware/delay.ts)

## log()

`log()` logs subscriptions, publishes, processed messages and errors. Many loggers (eg Pino and Bunyan) are supported without further configuration, but some (most notably Winston) prefer an event's message to be under the `message` key instead of `msg`. For these loggers, you can provide the `messageKey: 'message'` argument so that log events from Announce look the same as log events from other parts of your system.

### Options

- `logger`: (required) The logger. By default, log() will work with any logger that provides the following interface: `{debug: (details: {msg: string}), info: (details: {msg: string}) => any, error: (details: {msg: string, error: any})`.
- `messageKey`: Overrides the key the textual message is placed in. Set this to "message" if you are using a Winston-like logger
- `logLevels`: Overrides the level each event is logged at. For example, by default successful publishes are logged at `debug` level; you can change this to `info` with the following value: `{publishSuccess: 'info'}`. Supported keys are `subscribeSuccess`, `subscribeError`, `publishSuccess`, `publishError`, `handleSuccess`, `handleError`

Source: [log.ts](./src/middleware/log.ts)

## retry()

`retry()` helps your application automatically recover from temporary failures, for example an unreachable server or overloaded database. If a message is rejected, it will wait a while before attempting to process the message again. It will wait an exponentially-increasing amount of time each time a particular message fails, until eventually rejecting the message after a maximum number of attempts.

### Options

- `initialDelay`: How long (in milliseconds) to wait before reprocessing a message the first time it fails. Default: 1,000ms
- `increaseFactor`: How much to increase the delay each time a message fails. For example, if the `initialDelay` is 1000 and `increaseFactor` is 3, `delay()` will wait for 1000ms _ 3 _ 3 = 9000ms before retrying the message a second time. Default: 10
- `variation`: How much to randomly vary the delay by to help mitigate the [thundering herd problem](https://en.wikipedia.org/wiki/Thundering_herd_problem). Changes the actual delay by a multiple of the computed delay (from `initialDelay` and `increaseFactor`, above). For example, if `initialDelay` is 1000, `increaseFactor` is 3, `variation` is 0.2 and this is the second attempt, the computed delay will be 1000ms _ 3 _ 3 = 9000ms, and the actual delay will be somewhere between 9000ms - (9000ms _ 0.2) = 7200ms and 9000ms + (9000ms _ 0.2) = 10800ms. Default: 0.1
- `maxRetries`: The maximum number of times `delay()` will retry a message. Default: 5
- `canRetry(error, message)`: If this function is provided and returns false, a message will not be retried. Use this to immediately reject messages that will never be successful, for example messages that have an invalid body. Default: retry all messages.

### Developing with `retry()`

When developing and testing, messages are often rejected due to bugs or incomplete code. To avoid clutter when testing and debugging, in most cases we would prefer to just reject these messages rather than retrying them. To do this while still automatically retrying messages in production, you can do something like this:

```javascript
retry({ maxRetries: process.env.NODE_ENV !== 'production' ? 0 : undefined })
```

This will cause `retry()` to retry the default number of times when running in production, but avoid retrying when developing or testing. In development and testing, failed messages will be immediately rejected.

Source: [retry.ts](./src/middleware/retry.ts)

## spy()

`spy()` allows you to watch what is happening in the Announce instance - subscribing, publishing and message handling. It is useful for logging, testing and debugging.

### Options

- `beforeHandle({message, subscriber, announce})`: Called before a message is handled
- `onHandle({message, subscriber, announce})`: Called after a message has been successfully handled
- `onHandleError({error, message, subscriber, announce})`: Called when the message handler threw an error
- `beforePublish({message, announce})`: Called before a message is published
- `onPublish({message, announce})`: Called after a message has been successfully published
- `onPublishError({error, message, subscriber, announce})`: Called when publishing a message failed
- `beforeSubscribe({subscriber, announce})`: Called before a subscriber is added
- `onSubscribe({subscriber, announce})`: Called when a subscriber is successfully added
- `onSubscribeError({error, subscriber, announce})`: Called when adding a subscriber failed

Source: [spy.ts](./src/middleware/spy.ts)

## subscriptionFilter()

`subscriptionFilter()` controls which subscribers are allowed to subscribe. Subscriptions that don't match the filter are silently ignored. This is useful for creating specialised application instances that only handle certain queues, or for disabling subscriptions entirely (for example, in a web server that only publishes messages and doesn't process any).

### Options

- `filter`: The filter to apply. Subscriptions that don't match the filter will be ignored. Can be a string (exact match on queueName), RegExp (tests on queueName), or a function that accepts the subscriber as its only argument.

Source: [subscriptionFilter.ts](./src/middleware/subscriptionFilter.ts)

# Writing middleware

Announce's middleware system allows you to hook into four operations: publishing, subscribing, message handling, and queue destruction. A middleware is a function that receives a `MiddlewareArgs` object and calls one or more `add*Middleware` functions to install its hooks.

Here is a simple middleware that logs whenever a message is published:

```typescript
import { Middleware } from '@emigrad/announce'

const logPublishes: () => Middleware = () => {
  return ({ addPublishMiddleware }) => {
    addPublishMiddleware(async ({ message, next }) => {
      console.log(`Publishing to ${message.topic}`)
      await next(message)
      console.log(`Published to ${message.topic}`)
    })
  }
}

announce.use(logPublishes())
```

The `next` function passes control to the next middleware in the chain (or the backend, if there are no more middlewares). You **must** call `next` to continue the chain, or the operation will be silently dropped.

## Available hooks

Each `add*Middleware` function receives a different set of arguments:

### `addPublishMiddleware(({ message, next }) => ...)`

Called when a message is about to be published. Call `next(message)` to pass the message to the next middleware. You can modify the message before passing it on.

### `addSubscribeMiddleware(({ subscriber, next }) => ...)`

Called when a subscriber is being added. Call `next(subscriber)` to continue. You can modify the subscriber (for example, wrapping its `handle` function) before passing it on.

### `addHandleMiddleware(({ message, subscriber, next }) => ...)`

Called when a message is received by a subscriber. Call `next(message)` to pass the message to the next middleware and eventually the subscriber's handler.

### `addDestroyQueueMiddleware(({ queueName, next }) => ...)`

Called when a queue is being destroyed. Call `next(queueName)` to continue.

## Additional capabilities

The middleware function also receives:

- `announce`: The Announce instance the middleware is being added to. Useful for listening to events like `'close'`.
- `publish(...messages)`: Publishes messages, bypassing any middleware added _after_ this one. Useful for internal republishing (as done by `retry()`).
- `destroyQueue(queueName)`: Destroys a queue, bypassing any middleware added after this one.

## Example: a simple timing middleware

```typescript
const timing: () => Middleware = () => {
  return ({ addHandleMiddleware }) => {
    addHandleMiddleware(async ({ message, subscriber, next }) => {
      const start = Date.now()
      try {
        await next(message)
      } finally {
        console.log(`${subscriber.queueName} took ${Date.now() - start}ms`)
      }
    })
  }
}
```

For more complete examples, see the source code of the built-in middlewares such as [spy.ts](./src/middleware/spy.ts) and [retry.ts](./src/middleware/retry.ts).

# Writing backends

A backend is a class that implements the `Backend` interface and provides a static `accepts(url)` method. To create a custom backend:

1. Implement the `Backend` interface:

```typescript
import { EventEmitter } from 'events'
import { Backend, BackendSubscriber, Message, Middleware } from '@emigrad/announce'

export class MyBackend extends EventEmitter implements Backend {
  static accepts(url: string): boolean {
    return url.startsWith('myprotocol://')
  }

  async publish(message: Message<Buffer>): Promise<void> {
    // Send the message to all subscribers with matching topics
  }

  async subscribe(subscriber: BackendSubscriber): Promise<void> {
    // Register the subscriber and start delivering matching messages
  }

  async destroyQueue(queueName: string): Promise<void> {
    // Remove the queue and any unprocessed messages
  }

  async close(): Promise<void> {
    // Close any connections and clean up resources
  }

  getPolyfills(): Middleware[] {
    // Return any polyfill middlewares your backend needs.
    // Use rejectMultipleSubscriptions() if your backend doesn't
    // natively prevent duplicate subscriptions.
    // Use deadLetterQueue() if your backend doesn't natively
    // support dead letter queues.
    return []
  }
}
```

2. Register it using a custom backend factory:

```typescript
import { Announce, backendFactory } from '@emigrad/announce'

const announce = new Announce({
  url: 'myprotocol://localhost',
  backendFactory: backendFactory([MyBackend, ...defaultBackends])
})
```

The backend must emit an `'error'` event if it encounters an unrecoverable error (such as a lost connection). This will cause the Announce instance to close.

# Logging

Announce supports two kinds of logging:

## Application-level logging with `log()`

The `log()` middleware logs message publishes, subscriptions, handled messages and errors through a logger of your choice. See the [log()](#log) section for details.

## Debug logging

Announce uses the [debug](https://www.npmjs.com/package/debug) package for low-level internal logging. To enable it, set the `DEBUG` environment variable:

```shell
# Log everything from Announce
DEBUG=announce:* node app.js

# Log only the InMemory backend
DEBUG=announce:InMemory node app.js

# Log only the FileBackend
DEBUG=announce:FileBackend node app.js
```

This is useful for diagnosing issues with message delivery, queue management and backend connections.

# Configuration

Announce is configured primarily through environment variables and constructor arguments.

## Environment variables

- `ANNOUNCE_BACKEND_URL`: The URL of the backend to connect to. This is the primary configuration option.

## Backend URLs

| Backend | URL scheme | Example |
|---------|-----------|---------|
| InMemory | `memory://` | `memory://` |
| File | `file://` | `file:///tmp/announce` |
| RabbitMQ | `amqp://` or `amqps://` | `amqp://user:pass@localhost:5672/events` |

For the RabbitMQ backend, the path component of the URL is used as the exchange name. If no path is provided, the exchange defaults to `events`.

## Subscriber options

- `concurrency`: How many messages can be processed simultaneously by a single subscriber. Default: `1`. Increase this for subscribers that spend most of their time waiting on I/O.
- `preserveRejectedMessages`: Whether to save rejected messages in a dead letter queue. Default: `true`.

# Subscribing

To receive messages, add a subscriber using `announce.subscribe()`:

```typescript
await announce.subscribe({
  queueName: 'send-welcome-emails',
  topics: ['user.created'],
  async handle(message, { announce }) {
    await sendWelcomeEmail(message.body.email)
  }
})
```

You can subscribe to multiple topics at once:

```typescript
await announce.subscribe({
  queueName: 'user-audit-log',
  topics: ['user.created', 'user.updated', 'user.deleted'],
  async handle(message) {
    await auditLog.write(message.topic, message.body)
  }
})
```

Use wildcards to match multiple topics:

```typescript
await announce.subscribe({
  queueName: 'all-user-events',
  topics: ['user.*'],       // matches user.created, user.deleted, etc.
  handle: handleUserEvent
})

await announce.subscribe({
  queueName: 'all-created-events',
  topics: ['**.created'],    // matches user.created, org.membership.created, etc.
  handle: handleCreatedEvent
})
```

You can add multiple subscribers in a single call:

```typescript
await announce.subscribe(emailSubscriber, analyticsSubscriber, auditSubscriber)
```

## Concurrency

By default, each subscriber processes one message at a time. To process multiple messages in parallel:

```typescript
await announce.subscribe({
  queueName: 'image-processor',
  topics: ['image.uploaded'],
  options: { concurrency: 5 },
  async handle(message) {
    await processImage(message.body)
  }
})
```

# Publishing

To send a message, call `announce.publish()`:

```typescript
await announce.publish({
  topic: 'user.created',
  body: { id: 123, email: 'user@example.com' }
})
```

You can publish multiple messages in a single call:

```typescript
await announce.publish(
  { topic: 'user.created', body: newUser },
  { topic: 'audit.entry', body: { action: 'user.created', userId: newUser.id } }
)
```

The returned promise resolves with an array of the published messages, each with its `id` and `date` properties filled in:

```typescript
const [message] = await announce.publish({ topic: 'test', body: { hello: 'world' } })
console.log(message.properties.id)   // unique ID
console.log(message.properties.date) // publication date
```

You can also add custom headers:

```typescript
await announce.publish({
  topic: 'order.placed',
  body: order,
  headers: { 'x-priority': 'high' }
})
```

# Events

The Announce instance is an `EventEmitter` and emits the following events:

## `'error'`

Emitted when the backend encounters an unrecoverable error. After emitting this event, the Announce instance will close.

```typescript
announce.on('error', (err) => {
  console.error('Fatal announce error:', err)
  process.exit(1)
})
```

## `'close'`

Emitted after the Announce instance has closed.

```typescript
announce.on('close', () => {
  console.log('Announce has shut down')
})
```

# Writing unit tests

Announce is designed to be easy to test. The `memory://` backend runs entirely in-process with no external dependencies, making it ideal for unit tests.

## Basic test setup

```typescript
import { Announce, json } from '@emigrad/announce'

describe('my subscriber', () => {
  let announce: Announce

  beforeEach(() => {
    announce = new Announce({ url: 'memory://' })
    announce.use(json())
  })

  afterEach(() => announce.close())

  it('should process messages', async () => {
    const received: any[] = []

    await announce.subscribe({
      queueName: 'test',
      topics: ['user.created'],
      handle(message) {
        received.push(message.body)
      }
    })

    await announce.publish({ topic: 'user.created', body: { id: 1 } })

    // Allow the message to be processed
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(received).toEqual([{ id: 1 }])
  })
})
```

## Using `spy()` to wait for message processing

The `spy()` middleware is particularly useful in tests because it provides hooks that let you know when messages have been processed, removing the need for arbitrary timeouts:

```typescript
import { Announce, json, spy } from '@emigrad/announce'
import { Deferred } from 'ts-deferred'

it('should handle user creation', async () => {
  const handled = new Deferred()
  const announce = new Announce({ url: 'memory://' })
  announce.use(json(), spy({ onHandle: handled.resolve }))

  await announce.subscribe({
    queueName: 'test',
    topics: ['user.created'],
    handle(message) {
      // your handler logic
    }
  })

  await announce.publish({ topic: 'user.created', body: { id: 1 } })
  await handled.promise // resolves as soon as the handler finishes

  await announce.close()
})
```

## Testing that messages are published

Use the `spy()` middleware to verify that your code publishes the expected messages:

```typescript
it('should publish an event when a comment is added', async () => {
  const published = new Deferred()
  const announce = new Announce({ url: 'memory://' })
  announce.use(json(), spy({ onPublish: published.resolve }))

  await addComment(announce, { postId: 1, text: 'Great post!' })

  const { message } = await published.promise
  expect(message.topic).toBe('comment.created')
})
```

# Backends

## InMemory backend

**URL:** `memory://`

A simple in-memory backend suitable for development and testing. Messages are lost when the process exits. Only a single instance of the application can send and receive messages.

```dotenv
ANNOUNCE_BACKEND_URL=memory://
```

## File backend

**URL:** `file://<path>`

A filesystem-backed backend that provides at-least-once delivery guarantees. Messages are persisted to disk and survive application restarts. Multiple processes on the same machine can share a single file backend.

```dotenv
ANNOUNCE_BACKEND_URL=file:///tmp/announce
```

**Limitations:**
- Only works with local filesystems. Network filesystems (NFS, SMB) are not supported because they don't reliably provide file change notifications.
- Not suitable for multi-machine deployments. Use RabbitMQ instead.

**Features:**
- Guaranteed delivery
- Dead letter queues
- Survives application restarts
- Multiple local processes can share the same backend

## RabbitMQ backend

**URL:** `amqp://<host>` or `amqps://<host>`

A production-ready backend that connects to [RabbitMQ](https://www.rabbitmq.com/). Suitable for multi-instance and multi-service deployments.

```dotenv
ANNOUNCE_BACKEND_URL=amqp://user:password@rabbitmq.example.com:5672/events
```

The path component of the URL is used as the RabbitMQ exchange name (defaults to `events` if not specified). The exchange is created as a topic exchange.

**Requirements:**
- The `amqplib` package must be installed: `yarn add amqplib`

**Features:**
- Guaranteed delivery
- Dead letter queues (native RabbitMQ support)
- Inter-service messaging
- Multiple application instances
- Messages persist across restarts (when using durable queues)

### Running RabbitMQ locally

A `docker-compose.yml` is included for running RabbitMQ during development:

```shell
yarn services:start
```

This starts RabbitMQ with the management plugin on `amqp://localhost:5672` (management UI at `http://localhost:15672`).

# Troubleshooting

## My subscriber doesn't receive messages

1. **Check the topics:** Ensure the subscriber's topic patterns match the published message's topic. Remember that `*` only matches a single level (`user.*` matches `user.created` but not `user.account.created`), while `**` matches zero or more levels.
2. **Check subscriber registration:** Make sure `await announce.subscribe(...)` completed before the message was published.
3. **Check the backend URL:** If using multiple Announce instances, ensure they all point to the same backend.
4. **Check the backend type:** The InMemory backend only delivers messages to subscribers within the same process. For cross-process messaging, use the File or RabbitMQ backend.
5. **Check the logs:** Add the `log()` middleware and check for errors.
6. **Enable debug logging:** Set `DEBUG=announce:*` to see low-level backend activity.

## Delay isn't delaying messages

The `delay()` middleware measures the delay from when the message was _published_, not from when it was received. If the message takes longer to arrive than the configured delay, it will be processed immediately.

## My RabbitMQ connection keeps disconnecting

Check that:
1. The RabbitMQ server is running and reachable.
2. The credentials in the URL are correct.
3. No firewall or network policy is dropping idle connections.
4. The RabbitMQ server has enough resources (memory, disk space).

## My process is using too much memory

Reduce the `concurrency` setting on your subscribers. Each in-flight message consumes memory, so a high concurrency with large messages can add up. If you have many subscribers, consider using `subscriptionFilter()` to spread them across multiple processes.

## Messages are being processed too slowly

The default `concurrency` is `1`, meaning messages are processed one at a time. Try increasing it:

```typescript
await announce.subscribe({
  queueName: 'slow-subscriber',
  topics: ['work.*'],
  options: { concurrency: 10 },
  handle: processWork
})
```

## How to turn on debug logging

Set the `DEBUG` environment variable before starting your application:

```shell
DEBUG=announce:* node app.js
```
