import { z } from 'zod'
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a project name from 1 to 100 characters.')
  .max(100, 'Enter a project name from 1 to 100 characters.')
