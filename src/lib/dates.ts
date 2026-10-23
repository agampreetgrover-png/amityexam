import { addDays, differenceInCalendarDays, format } from "date-fns";
import type { ISODay } from "./types";

const toDay = (d: Date): ISODay => format(d, "yyyy-MM-dd");
export const fromDay = (s: ISODay): Date => {
  const [y, m, d] = s.split("-").map(Number); // local midnight, like date-fns parse but without its weight
  return new Date(y, m - 1, d);
};
export const today = (): ISODay => toDay(new Date());
export const addDay = (s: ISODay, n: number): ISODay => toDay(addDays(fromDay(s), n));
export const daysBetween = (a: ISODay, b: ISODay): number =>
  differenceInCalendarDays(fromDay(b), fromDay(a));
export const prettyDay = (s: ISODay): string => format(fromDay(s), "EEE, d MMM");
