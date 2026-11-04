import type { User } from './types.ts'

/** The HTTP wrapper already unwraps response.data. */
export type Client = {
  get(path: '/users'): Promise<User[]>
}
