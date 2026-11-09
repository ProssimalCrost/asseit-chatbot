import { prisma } from "./db";
import { config } from "./config";

export const HOURS_TEXT = "segunda a sexta, das 08h às 18h; sábado, das 08h às 12h";

// 0 = domingo ... 6 = sábado. Valores em minutos desde 00:00.
const WEEKLY: Record<number, [number, number]> = {
  1: [8 * 60, 18 * 60],
  2: [8 * 60, 18 * 60],
  3: [8 * 60, 18 * 60],
  4: [8 * 60, 18 * 60],
  5: [8 * 60, 18 * 60],
  6: [8 * 60, 12 * 60],
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nowInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS[get("weekday")],
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export async function isOpenNow(date = new Date()): Promise<boolean> {
  const { dateKey, weekday, minutes } = nowInSaoPaulo(date);

  const exception = await prisma.businessCalendar.findUnique({ where: { dateKey } });
  if (exception) {
    if (exception.closed) return false;
    if (exception.opensAtMin != null && exception.closesAtMin != null) {
      return minutes >= exception.opensAtMin && minutes < exception.closesAtMin;
    }
  }

  const window = WEEKLY[weekday];
  return !!window && minutes >= window[0] && minutes < window[1];
}
