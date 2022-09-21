export const QUEUES_DIRECTORY = 'queues'
export const SUBSCRIPTIONS_DIRECTORY = 'subscriptions'
export const READY_DIRECTORY = 'ready'
export const PROCESSING_DIRECTORY = 'processing'

// How long to update the modtime on the processing file
export const KEEPALIVE_INTERVAL = 10000
// How far in the past the modtime on the processing file must be
// before the process is considered to be crashed
export const RESTORE_MESSAGES_AFTER = 60000
