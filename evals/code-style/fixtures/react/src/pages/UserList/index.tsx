import { useEffect, useState } from 'react'
import { fetchUsers } from './api'
import type { User, UserListProps } from './type'

const UserList = (props: UserListProps) => {
  const { teamId } = props
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true
    setIsLoading(true)
    setError(null)
    fetchUsers(teamId)
      .then(result => {
        if (isActive) setUsers(result)
      })
      .catch(() => {
        if (isActive) setError('Unable to load users')
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })
    return () => { isActive = false }
  }, [teamId])

  const visibleUsers = users.filter(user => user.name.toLowerCase().includes(query.toLowerCase()))
  if (isLoading) return <p>Loading</p>
  if (error) return <p role="alert">{error}</p>
  return (
    <main>
      <h1>Users</h1>
      <label>Search<input aria-label="Search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <ul>{visibleUsers.map(user => <li key={user.id}>{user.name}</li>)}</ul>
    </main>
  )
}

export default UserList
