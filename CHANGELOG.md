# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.7.2](https://github.com/emigrad/announce/compare/v0.7.1...v0.7.2) (2025-04-11)


### Features

* add ability to filter subscriptions ([136e172](https://github.com/emigrad/announce/commit/136e172c7beca96fd9db9abfbcf4e2e83e27b8e2))
* log message latency ([022432e](https://github.com/emigrad/announce/commit/022432e662c0d62d71bc131538ae3279eb73c463))

### [0.7.1](https://github.com/emigrad/announce/compare/v0.7.0...v0.7.1) (2023-05-24)

### Miscellaneous

- replace cuid with cuid2 for message generation ([f265559](https://github.com/emigrad/announce/commit/f265559b0985755bdb3e247e4d8b749eb36d51b9))

## [0.7.0](https://github.com/emigrad/announce/compare/v0.6.1...v0.7.0) (2022-10-28)

### ⚠ BREAKING CHANGES

- backends now reject attempts to add multiple subscribers to the smae queue

### Features

- err parameter to destroy() is now optional ([ad7d7ac](https://github.com/emigrad/announce/commit/ad7d7acf46ed496d5dde931abd7acd8b59585966))
- **FileBackend:** support multiple processes ([40ffa76](https://github.com/emigrad/announce/commit/40ffa767a8f6315006834b82b5a0c4f66fdf6fa4))

### Bug Fixes

- batch now removes any pending timeouts when Announce.close() is called ([12902c7](https://github.com/emigrad/announce/commit/12902c702166ba1542d5506cd95bd350b83bd193))

- ensure backends support re-adding deleted subscribers ([152e62b](https://github.com/emigrad/announce/commit/152e62b6175aa721629b9847563311d05896d887))

### [0.6.1](https://github.com/emigrad/announce/compare/v0.6.0...v0.6.1) (2022-09-17)

### Features

- **RabbitMQ:** operations now reject with the message of the error if the connection closed ([1c99c78](https://github.com/emigrad/announce/commit/1c99c78318727235f0b5fb51cad37a7047b65b16))

### Bug Fixes

- retried messages should not pass through middleware added later ([909948c](https://github.com/emigrad/announce/commit/909948c85d37dd8d8d3cf3ae253b6d4b50411998))

## [0.6.0](https://github.com/emigrad/announce/compare/v0.5.1...v0.6.0) (2022-09-10)

### ⚠ BREAKING CHANGES

- log() now accepts its arguments as
  an object (the same as most other Announce functions)
  rather than receiving the logger instance
  as its first parameter
- change BackendFactory to be a function
- change Announce constructor to accept a single arg
- middleware must now call the provided
  functions
  to register handler/subscriber/publish middleware
  instead of returning an object.
- make amqplib an optional peer dependency
- reverse middleware order

### Features

- change Announce constructor to accept a single arg ([e921239](https://github.com/emigrad/announce/commit/e921239d16a81ef62d02da91f279b8ec42bc987e))
- change to MIT license ([6793ee6](https://github.com/emigrad/announce/commit/6793ee6b302e80580643e834fb6492db81f9f88b))
- make middleware definitions more intuitive ([5fa0961](https://github.com/emigrad/announce/commit/5fa0961a154337c8a9ff1532518b71f18b9e8057))
- support specifying logging levels and message key ([bdcbb39](https://github.com/emigrad/announce/commit/bdcbb39a1ca9bd1aee6e6ab426fe36bd1304dcf3))

### Bug Fixes

- export @types/promise-queue ([8b337a0](https://github.com/emigrad/announce/commit/8b337a0cb0c34a4e652134a1dc17509e59117254))

- change BackendFactory to be a function ([cd5a8ca](https://github.com/emigrad/announce/commit/cd5a8ca8eed38b2c6200c3a379b099817e188710))
- make amqplib an optional peer dependency ([da33aec](https://github.com/emigrad/announce/commit/da33aec52f5cc3d8cc502dd5fec0c6f12b776de1))
- reverse middleware order ([917db3b](https://github.com/emigrad/announce/commit/917db3b5e9178467458a3bd907720d0a60357069))

### [0.5.1](https://gitlab.com/emigrad/announce/compare/v0.5.0...v0.5.1) (2022-05-02)

### Bug Fixes

- add missing export for batch ([39e9bc8](https://gitlab.com/emigrad/announce/commit/39e9bc86ff09c26b77274f96e5d43934a821d679))

## [0.5.0](https://gitlab.com/emigrad/announce/compare/v0.4.5...v0.5.0) (2022-05-02)

### ⚠ BREAKING CHANGES

- publish rejected messages to the dead letter topic
- change subscriber name property to queueName
- rename jsonSerializer middleware to json

### Features

- add batch middleware ([e808a35](https://gitlab.com/emigrad/announce/commit/e808a35e2ea799b7deabcc2bd74abefcdeaa5ebd))
- add retry and spy middlewares ([ac20bbb](https://gitlab.com/emigrad/announce/commit/ac20bbb852042b926d23cb6bd3434df82435936e))
- change subscriber name property to queueName ([e378052](https://gitlab.com/emigrad/announce/commit/e3780528ffdb6938f4b0922c11f48bb398447c62))
- make the "not a Buffer" error more helpful ([d5c5fa8](https://gitlab.com/emigrad/announce/commit/d5c5fa80bc2c0e3fa0e6f82804b9a23eb71b6f6b))
- publish rejected messages to the dead letter topic ([1a073c0](https://gitlab.com/emigrad/announce/commit/1a073c0a7ba5562bc85c89816c433a60d36bd356))
- rename jsonSerializer middleware to json ([72d4488](https://gitlab.com/emigrad/announce/commit/72d448828e3ff536746c34bf6eee84e0e7117529))

### Bug Fixes

- memory/file backends sending the same message to duplicate subscribers ([c58ed89](https://gitlab.com/emigrad/announce/commit/c58ed894ca9665870042a65fd69b1f790e4755e9))

### [0.4.5](https://gitlab.com/emigrad/announce/compare/v0.4.4...v0.4.5) (2021-10-30)

### Bug Fixes

- type declation of subscribe() ([7cd7cb5](https://gitlab.com/emigrad/announce/commit/7cd7cb59aeb25041ca4d9c6572976a70e6f4590e))

### [0.4.4](https://gitlab.com/emigrad/announce/compare/v0.4.3...v0.4.4) (2021-10-19)

### Bug Fixes

- compatibility fix for pino/bunyan loggers ([f578412](https://gitlab.com/emigrad/announce/commit/f57841236ab93010eddf80908625bfe5cc7a7627))

### [0.4.3](https://gitlab.com/emigrad/announce/compare/v0.4.2...v0.4.3) (2021-10-17)

### Bug Fixes

- support amqps:// for rabbit connections ([afd0f86](https://gitlab.com/emigrad/announce/commit/afd0f865048c267e5b9cb1441a6514e5ed6d8e50))

### [0.4.2](https://gitlab.com/emigrad/announce/compare/v0.4.1...v0.4.2) (2021-10-16)

### Bug Fixes

- correctly bind wildcard topics ([9739d52](https://gitlab.com/emigrad/announce/commit/9739d5214f78852410e474a251578270a7a010ca))

### [0.4.1](https://gitlab.com/emigrad/announce/compare/v0.4.0...v0.4.1) (2021-10-16)

### Bug Fixes

- correctly send rejected messages to the DLQ ([f4fd8af](https://gitlab.com/emigrad/announce/commit/f4fd8af19b2209129740b85bd008fe02ea16217d))

## [0.4.0](https://gitlab.com/emigrad/announce/compare/v0.3.1...v0.4.0) (2021-10-13)

### ⚠ BREAKING CHANGES

- Return type of Announce.publish() has changed

### Features

- publish() and subscribe() now accept multiple messages/subscribers ([cd21094](https://gitlab.com/emigrad/announce/commit/cd21094294d697bdffa61521df6719b0881089d5))

### Bug Fixes

- correctly handle subscribers that are instances of a class ([f560e7c](https://gitlab.com/emigrad/announce/commit/f560e7c1caf8c17b6ea5a38e91c1321b4b471973))

### [0.3.1](https://gitlab.com/emigrad/announce/compare/v0.3.0...v0.3.1) (2021-09-30)

### Bug Fixes

- fix package entrypoint ([44d50c8](https://gitlab.com/emigrad/announce/commit/44d50c8921ef7cc1282a635318d63a37c8edcd5c))

## [0.3.0](https://gitlab.com/emigrad/announce/compare/v0.2.0...v0.3.0) (2021-09-30)

### ⚠ BREAKING CHANGES

- rename publishedAt to date
- rename PublishMessage to UnpublishedMessage

### Features

- dates for messages sent over RabbitMQ now have millisecond precision ([d9dc432](https://gitlab.com/emigrad/announce/commit/d9dc43206657544f30e6957816d313c69932199d))
- rename publishedAt to date ([954c9c6](https://gitlab.com/emigrad/announce/commit/954c9c6899d0b3767d882deaf0ddf07677fe60f4))
- rename PublishMessage to UnpublishedMessage ([d0b960b](https://gitlab.com/emigrad/announce/commit/d0b960b4344a09b17f092f72cbd9493bedb8a494))

## [0.2.0](https://gitlab.com/emigrad/announce/compare/v0.1.1...v0.2.0) (2021-09-29)

### ⚠ BREAKING CHANGES

- move message ID and publish date to separate field
- change middleware signature
- change subscribe() to not accept middlewares

### Features

- add delay middleware ([bfef07c](https://gitlab.com/emigrad/announce/commit/bfef07c8248a7a1ec13cb50ed1ef2713244fad52))
- change middleware signature ([34bf877](https://gitlab.com/emigrad/announce/commit/34bf8773f69c4b5cdca07637954555b4c5c26668))
- emit close() event once closed ([a41bf06](https://gitlab.com/emigrad/announce/commit/a41bf064909ab8e6f4dbc47911b91154b95b87d5))
- move message ID and publish date to separate field ([7dfea3e](https://gitlab.com/emigrad/announce/commit/7dfea3e6c1fda989ea5618fe563d91ab4b817846))
- support subscriber-specific middleware with with() ([e201187](https://gitlab.com/emigrad/announce/commit/e2011870e4ad43508df6de315fa085afaf003cd4))

- change subscribe() to not accept middlewares ([1f7e144](https://gitlab.com/emigrad/announce/commit/1f7e144eba9bd638032ead5378511faf8a1a8148))

### [0.1.1](https://gitlab.com/emigrad/announce/compare/v0.1.0...v0.1.1) (2021-09-26)

### Bug Fixes

- fix exported typings ([e3f325c](https://gitlab.com/emigrad/announce/commit/e3f325cefaf2b2339204cadbb35b54994a5a035b))

## 0.1.0 (2021-09-26)

### Features

- accept binary messages ([50228d0](https://gitlab.com/emigrad/announce/commit/50228d0a32d17581bb56a4d1ab6a169304c953e1))
- add JSON conversion middleware ([5598c62](https://gitlab.com/emigrad/announce/commit/5598c624bb2371012b0d166f114913034f02d197))
- add middleware for publishing and subscribing ([5544999](https://gitlab.com/emigrad/announce/commit/5544999b3b4289939017c17aaa6d038daf2af319))
- add persisted file store backend ([7d0a1b7](https://gitlab.com/emigrad/announce/commit/7d0a1b704e86d9816c7e46b50e16735b80919674))
- add RabbitMQ backend ([4579a93](https://gitlab.com/emigrad/announce/commit/4579a9397a338c6ae8d6a9e6a2ec0ca60743ebd5))
- allow multiple middlewares to be provided to use() ([b7f8087](https://gitlab.com/emigrad/announce/commit/b7f808791f5f7602401560257ea3b21c9c91a268))
- close backend when an unrecoverable error is encountered ([79818ed](https://gitlab.com/emigrad/announce/commit/79818edb7f318ca8fe6c1d9a84491c5a585f0fce))
- log message ID ([86e04dc](https://gitlab.com/emigrad/announce/commit/86e04dc8c12460699edb20b4e9189cd981d3c897))
- select the appropriate backend from ANNOUNCE_BACKEND_URL ([fc22822](https://gitlab.com/emigrad/announce/commit/fc2282275517a756fd929a5d6db6e1217558ae1b))

### Bug Fixes

- fix entrypoint ([7b823cd](https://gitlab.com/emigrad/announce/commit/7b823cdb0ae4dc411c229964b012a98fb92635f4))
