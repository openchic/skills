const normalizeEmail = value => value.trim().toLowerCase()

export const getEmailReport = emails => emails.map(normalizeEmail)
