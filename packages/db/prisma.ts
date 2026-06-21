import { PrismaClient, Prisma } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

export * from "./generated/prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL ?? "");
export const prisma = new PrismaClient({ adapter: adapter });
