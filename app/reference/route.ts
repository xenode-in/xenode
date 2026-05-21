import { ApiReference } from '@scalar/nextjs-api-reference'

const config = {
  url: '/openapi.json',
  theme: 'purple',
} as const

export const GET = ApiReference(config)
