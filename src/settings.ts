import { prisma } from "./db";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.botSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}
