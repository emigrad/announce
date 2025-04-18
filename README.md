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

Publish/subscribe

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

# Error handling

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

## delay()

`delay()` delays the processing of messages. This can be useful when Announce is being used as a job-processing system, or to wait until something has stopped happening before acting. For example the application may wish to email a summary of a conversation or series of actions to avoid spamming users.

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

### Options

- `filter`: The filter to apply. Subscriptions that don't match the filter will be ignored. Can be a string (exact match on queueName), RegExp (tests on queueName), or a function that accepts the subscriber as its only argument.

Source: [subscriptionFilter.ts](./src/middleware/subscriptionFilter.ts)

# Writing middleware

See spy() example in retry.test.js

# Writing backends

# Design

# Logging

# Configuration

# Subscribing

# Publishing

# Patterns

- Perform an action after things _stop_ happening
  - When there are change logs
  - When there aren't change logs
- Webhooks
  - Receiving events
  - Sending events
- Batch processing
- Emails and push notifications
  - (should be one message per email, so that users don't get emailed multiple times due to unrelated failures)
- Job systems
- Live query updates
- Cache invalidation
  - Direct invalidation
  - Indirect invalidation
- Soft start

# Events

# Writing unit tests

# Usage with TypeDI

# Backends

# Troubleshooting

- My subscriber doesn't receive message - (check topics, check that subscriber was added, check that message was sent, if using multiple instances of announce check that they're pointing to the same server, if using multiple instances of announce, check that they're using a backend that supports that, check logs for errors)
- Delay isn't delaying messages. Delay starts the clock from when the message was sent, not received
- My rabbit server is disconnecting. Check that
- My process is using too much memory. Reduce the concurrency setting. If using many subscribers, you may want to use a PromiseQueue to limit the number of messages processed simultaneously
- Messages are being processed too slowly. Concurrency is 1 by default, try increasing
- Turning on debug logging
