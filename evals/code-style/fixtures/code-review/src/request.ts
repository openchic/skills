type User = { name: string }

/** Fetch and display the current user's name. */
export const getUserName = async (request: () => Promise<User>) => {
  let user = {} as User
  request().then(result => { user = result })
  return user.name.toUpperCase()
}
