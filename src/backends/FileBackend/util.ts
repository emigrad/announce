import { FSWatcher } from 'chokidar'
import { rename as renameCb, writeFile as writeFileCb } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import { Message } from '../../types'

const writeFile = promisify(writeFileCb)
const rename = promisify(renameCb)

export async function atomicWriteFile(
  path: string,
  contents: string | Buffer
): Promise<void> {
  const tempPath = `${path}.${Math.random()}.tmp`

  await writeFile(tempPath, contents)
  await rename(tempPath, path)
}

export async function waitForReady(watcher: FSWatcher): Promise<void> {
  await new Promise((resolve, reject) => {
    watcher.on('ready', resolve)
    watcher.on('error', reject)
  })
}

export function getQueueNameFromSubscriberPath(path: string): string {
  return decodeURIComponent(basename(path).replace(/\.json$/, ''))
}

export function getQueueNameFromMessagePath(path: string): string {
  // path is in the format /(base dir)/queue name/ready|processing/id.json
  return basename(dirname(dirname(path)))
}

export function getQueuePath(queuesPath: string, queueName: string): string {
  return join(queuesPath, encodeURIComponent(queueName))
}

export function serializeMessage(message: Message<Buffer>): Buffer {
  const contents = JSON.stringify({
    ...message,
    body: message.body.toString('base64')
  })

  return Buffer.from(contents)
}

export function deserializeMessage(buffer: Buffer): Message<Buffer> {
  const parsedMessage = JSON.parse(buffer.toString()) as Message<string>
  parsedMessage.properties.date = new Date(parsedMessage.properties.date)

  return { ...parsedMessage, body: Buffer.from(parsedMessage.body, 'base64') }
}
