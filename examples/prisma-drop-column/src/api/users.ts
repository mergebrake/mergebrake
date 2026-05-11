import { prisma } from "../db.js";

// THIS FILE STILL READS full_name — MergeBrake should flag it.

export async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      // The next line still references the dropped column:
      full_name: true,
    },
  });
}

export async function searchByName(needle: string) {
  // Raw query that still mentions full_name
  return prisma.$queryRaw`SELECT id, email, full_name FROM users WHERE full_name ILIKE ${"%" + needle + "%"}`;
}
