import { prisma } from "../db.js";

export async function buildProfileCard(userId: number) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: u.id,
    email: u.email,
    // camelCase variant that ORMs typically expose for snake_case columns:
    name: u.fullName,
  };
}
