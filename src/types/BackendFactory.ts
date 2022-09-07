import { Backend } from './Backend'

/**
 * A function that returns a backend for the given URL
 */
export type BackendFactory = (url: string) => Backend | undefined
