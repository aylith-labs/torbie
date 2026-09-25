// Load .env before consumers read process.env. dotenv 18's config subpath has
// no type declaration, while the public config function is typed.
import { config } from 'dotenv'
config()
