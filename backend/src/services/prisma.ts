import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  var prismaClient: PrismaClient | undefined;
}

// Create connection pool (uses DATABASE_URL environment variable)
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/MINI";
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prisma = global.prismaClient || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.prismaClient = prisma;
}
