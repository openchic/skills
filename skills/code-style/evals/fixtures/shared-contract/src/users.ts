import type { Client } from './client.ts'
import type { User } from './types.ts'

/** Load all users from the API. */
export const loadUsers = (client: Client): Promise<User[]> => client.get('/users')
