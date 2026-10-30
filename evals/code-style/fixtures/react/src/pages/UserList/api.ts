import type { User } from './type'

export const fetchUsers = async (teamId: string): Promise<User[]> =>
  teamId === 'a'
    ? [{ id: '1', name: 'Alice' }, { id: '2', name: 'Aaron' }]
    : [{ id: '3', name: 'Bob' }]
