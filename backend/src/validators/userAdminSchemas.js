import { z } from 'zod';

const MAX_EXPERTISE = 20;

const text = (max) => z.string().trim().max(max);
// Same rule as sign-up (controllers/authController.js).
const email = text(254).toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address');

// The phrases the Recommendation Engine matches against, stored lowercase and without repeats.
export const expertiseSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(60))
  .max(MAX_EXPERTISE)
  .transform((phrases) => [...new Set(phrases)]);

const divisionId = z.string().trim().max(20).nullable();

// Which roles may be granted, and by whom, is decided in registrationService; this only checks shape.
export const roleSchema = z.object({
  role: z.string().trim().min(1).max(40),
  expertise: expertiseSchema.optional(),
  divisionId: divisionId.optional(),
});

export const rejectSchema = z.object({
  reason: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value ? value.trim() : '')),
});

export const emptySchema = z.object({}).strict();

// Strict: status, review fields and the password hash can never be written through these.
export const createSchema = z
  .object({
    name: text(120).min(1),
    email,
    department: text(120).optional(),
    designation: text(120).optional(),
    role: z.string().trim().min(1).max(40),
    divisionId: divisionId.optional(),
    expertise: expertiseSchema.optional(),
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .strict();

export const updateSchema = z
  .object({
    name: text(120).min(1),
    email,
    department: text(120),
    designation: text(120),
    role: z.string().trim().min(1).max(40),
    divisionId,
    expertise: expertiseSchema,
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' });

export const passwordSchema = z
  .object({
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .strict();
