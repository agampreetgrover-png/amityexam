import { addDays, differenceInCalendarDays, format, parse } from "date-fns";
import type { ISODay } from "./types";

const toDay = (d: Date): ISODay => format(d, "yyyy-MM-dd");
export const fromDay = (s: ISODay): Date => parse(s, "yyyy-MM-dd", new Date());
export const today = (): ISODay => toDay(new Date());
export const addDay = (s: ISODay, n: number): ISODay => toDay(addDays(fromDay(s), n));
export const daysBetween = (a: ISODay, b: ISODay): number =>
  differenceInCalendarDays(fromDay(b), fromDay(a));
export const weekday = (s: ISODay): number => fromDay(s).getDay();
export const prettyDay = (s: ISODay): string => format(fromDay(s), "EEE, d MMM");
