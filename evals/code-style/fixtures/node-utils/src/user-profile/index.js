const normalizeEmail = value => value.trim().toLowerCase()
const maskEmail = value => `${value.slice(0, 1)}***@${value.split('@')[1]}`

export const getUserProfile = email => {
  const normalized = normalizeEmail(email)
  return { email: normalized, masked: maskEmail(normalized) }
}
