# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.4.0](https://gitlab.com/emigrad/announce/compare/v0.3.1...v0.4.0) (2021-10-13)


### ⚠ BREAKING CHANGES

* Return type of Announce.publish() has changed

### Features

* publish() and subscribe() now accept multiple messages/subscribers ([cd21094](https://gitlab.com/emigrad/announce/commit/cd21094294d697bdffa61521df6719b0881089d5))


### Bug Fixes

* correctly handle subscribers that are instances of a class ([f560e7c](https://gitlab.com/emigrad/announce/commit/f560e7c1caf8c17b6ea5a38e91c1321b4b471973))

### [0.3.1](https://gitlab.com/emigrad/announce/compare/v0.3.0...v0.3.1) (2021-09-30)


### Bug Fixes

* fix package entrypoint ([44d50c8](https://gitlab.com/emigrad/announce/commit/44d50c8921ef7cc1282a635318d63a37c8edcd5c))

## [0.3.0](https://gitlab.com/emigrad/announce/compare/v0.2.0...v0.3.0) (2021-09-30)


### ⚠ BREAKING CHANGES

* rename publishedAt to date
* rename PublishMessage to UnpublishedMessage

### Features

* dates for messages sent over RabbitMQ now have millisecond precision ([d9dc432](https://gitlab.com/emigrad/announce/commit/d9dc43206657544f30e6957816d313c69932199d))
* rename publishedAt to date ([954c9c6](https://gitlab.com/emigrad/announce/commit/954c9c6899d0b3767d882deaf0ddf07677fe60f4))
* rename PublishMessage to UnpublishedMessage ([d0b960b](https://gitlab.com/emigrad/announce/commit/d0b960b4344a09b17f092f72cbd9493bedb8a494))

## [0.2.0](https://gitlab.com/emigrad/announce/compare/v0.1.1...v0.2.0) (2021-09-29)


### ⚠ BREAKING CHANGES

* move message ID and publish date to separate field
* change middleware signature
* change subscribe() to not accept middlewares

### Features

* add delay middleware ([bfef07c](https://gitlab.com/emigrad/announce/commit/bfef07c8248a7a1ec13cb50ed1ef2713244fad52))
* change middleware signature ([34bf877](https://gitlab.com/emigrad/announce/commit/34bf8773f69c4b5cdca07637954555b4c5c26668))
* emit close() event once closed ([a41bf06](https://gitlab.com/emigrad/announce/commit/a41bf064909ab8e6f4dbc47911b91154b95b87d5))
* move message ID and publish date to separate field ([7dfea3e](https://gitlab.com/emigrad/announce/commit/7dfea3e6c1fda989ea5618fe563d91ab4b817846))
* support subscriber-specific middleware with with() ([e201187](https://gitlab.com/emigrad/announce/commit/e2011870e4ad43508df6de315fa085afaf003cd4))


* change subscribe() to not accept middlewares ([1f7e144](https://gitlab.com/emigrad/announce/commit/1f7e144eba9bd638032ead5378511faf8a1a8148))

### [0.1.1](https://gitlab.com/emigrad/announce/compare/v0.1.0...v0.1.1) (2021-09-26)


### Bug Fixes

* fix exported typings ([e3f325c](https://gitlab.com/emigrad/announce/commit/e3f325cefaf2b2339204cadbb35b54994a5a035b))

## 0.1.0 (2021-09-26)


### Features

* accept binary messages ([50228d0](https://gitlab.com/emigrad/announce/commit/50228d0a32d17581bb56a4d1ab6a169304c953e1))
* add JSON conversion middleware ([5598c62](https://gitlab.com/emigrad/announce/commit/5598c624bb2371012b0d166f114913034f02d197))
* add middleware for publishing and subscribing ([5544999](https://gitlab.com/emigrad/announce/commit/5544999b3b4289939017c17aaa6d038daf2af319))
* add persisted file store backend ([7d0a1b7](https://gitlab.com/emigrad/announce/commit/7d0a1b704e86d9816c7e46b50e16735b80919674))
* add RabbitMQ backend ([4579a93](https://gitlab.com/emigrad/announce/commit/4579a9397a338c6ae8d6a9e6a2ec0ca60743ebd5))
* allow multiple middlewares to be provided to use() ([b7f8087](https://gitlab.com/emigrad/announce/commit/b7f808791f5f7602401560257ea3b21c9c91a268))
* close backend when an unrecoverable error is encountered ([79818ed](https://gitlab.com/emigrad/announce/commit/79818edb7f318ca8fe6c1d9a84491c5a585f0fce))
* log message ID ([86e04dc](https://gitlab.com/emigrad/announce/commit/86e04dc8c12460699edb20b4e9189cd981d3c897))
* select the appropriate backend from ANNOUNCE_BACKEND_URL ([fc22822](https://gitlab.com/emigrad/announce/commit/fc2282275517a756fd929a5d6db6e1217558ae1b))


### Bug Fixes

* fix entrypoint ([7b823cd](https://gitlab.com/emigrad/announce/commit/7b823cdb0ae4dc411c229964b012a98fb92635f4))
