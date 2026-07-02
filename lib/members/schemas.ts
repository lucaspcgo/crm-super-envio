import { z } from "zod";

export const createMemberAccountSchema = z.object({
  orgSlug: z.string(),
  fullName: z.string().min(2, "Digite o nome da pessoa").max(120, "Nome muito longo"),
  email: z.string().email("Email inválido"),
  password: z.string().min(10, "A senha precisa ter no mínimo 10 caracteres"),
  role: z.enum(["admin", "member"]),
});

export type CreateMemberAccountInput = z.infer<typeof createMemberAccountSchema>;

export const changeRoleSchema = z.object({
  orgSlug: z.string(),
  membershipId: z.string().uuid(),
  newRole: z.enum(["admin", "member"]),
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const removeMemberSchema = z.object({
  orgSlug: z.string(),
  membershipId: z.string().uuid(),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

export const transferOwnershipSchema = z.object({
  orgSlug: z.string(),
  targetUserId: z.string().uuid(),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
