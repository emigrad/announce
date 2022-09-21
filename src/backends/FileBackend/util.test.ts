import { ignoreFileNotFoundErrors } from './util'

describe('FileBackend util', () => {
  test.each([
    Object.assign(new Error('file not found'), { code: 'ENOENT' }),
    new Error('Oh no'),
    null
  ])('ignoreFileNotFoundErrors(%p)', async (error) => {
    const promise = Promise.reject(error)

    if ((error as { code?: string })?.code === 'ENOENT') {
      expect(await ignoreFileNotFoundErrors(promise)).toBe(undefined)
    } else {
      await expect(ignoreFileNotFoundErrors(promise)).rejects.toBe(error)
    }
  })
})
