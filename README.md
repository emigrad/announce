# Announce

Announce is a robust library for implementing the publish/subscribe pattern in your applications. It is simple to use, easily extensible, and encourages patterns that will help keep your code clean and testable. 

Announce can run locally using a file or in-memory store, or can be backed by an external message broker such as RabbitMQ. 

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

While we recommend that you let Announce read the backend URL from the environment variable, you can also specify it directly if needed by providing it as the first parameter instead: `new Announce('memory://')`


An announce instance starts out as a blank slate - messages are sent and received directly to the backend, and only instances of `Buffer` can be used. We can make it much more useful by adding some middleware:

```typescript
// Add this at the top of the file 
import { Announce, log, jsonSerializer } from '@emigrad/announce'

const announce = new Announce()

// If you have a logger with a Winston-like API, you can 
// have announce log the messages it sends and receives
announce.use(log(logger))

// This allows us to send and receive any objects that can be serialised to JSON
announce.use(jsonSerializer())
```

Now we 

#Pub/sub
#Use cases
#API
#Error handling
#Writing middleware
#Using middleware
#Design
#Logging
#Configuration
#Subscribing
#Publishing
#Patterns
#Events
#Writing unit tests
#Usage with TypeDI
#Backends
