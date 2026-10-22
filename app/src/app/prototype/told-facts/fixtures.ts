// PROTOTYPE, throwaway: everything the viewer told Mycel, for "What I've told Mycel". Each told
// fact is about one subject (a person or company) and keeps the older notes it replaced.
import { daysAgo, minutesAgo } from "../ask/facts";

export type Subject = {
  id: string;
  kind: "person" | "company";
  name: string;
  /** The email address or domain Mycel knows the subject by. */
  key: string;
};

export type OlderNote = { id: string; statement: string; toldAt: Date; replacedAt: Date };

export type ToldFact = {
  id: string;
  subjectId: string;
  statement: string;
  toldAt: Date;
  /** Older notes on the same point this one replaced, newest first. */
  replaced: OlderNote[];
};

export const SUBJECTS: Record<string, Subject> = {
  acme: { id: "acme", kind: "company", name: "Acme", key: "acme.com" },
  jordan: { id: "jordan", kind: "person", name: "Jordan Lee", key: "jordan@acme.com" },
  brightline: {
    id: "brightline",
    kind: "company",
    name: "Brightline Foods",
    key: "brightlinefoods.com",
  },
  lena: { id: "lena", kind: "person", name: "Lena Park", key: "lena@northwind.io" },
  northwind: { id: "northwind", kind: "company", name: "Northwind", key: "northwind.io" },
  harbor: { id: "harbor", kind: "company", name: "Harbor Goods", key: "harborgoods.com" },
};

export const TOLD_FACTS: ToldFact[] = [
  {
    id: "t1",
    subjectId: "acme",
    statement: "Acme's renewals go through Priya Shah, not Tom Becker.",
    toldAt: minutesAgo(181),
    replaced: [
      {
        id: "t1-old",
        statement: "Acme's renewals go through Tom Becker.",
        toldAt: daysAgo(49),
        replacedAt: minutesAgo(181),
      },
    ],
  },
  {
    id: "t2",
    subjectId: "lena",
    statement: "Lena is on leave until Nov 10; send Northwind orders to ops@northwind.io.",
    toldAt: daysAgo(7),
    replaced: [],
  },
  {
    id: "t3",
    subjectId: "jordan",
    statement: "Jordan wants a phone call before any price change.",
    toldAt: daysAgo(20),
    replaced: [],
  },
  {
    id: "t4",
    subjectId: "harbor",
    statement: "Harbor Goods wants pallet quotes in Canadian dollars.",
    toldAt: daysAgo(32),
    replaced: [],
  },
  {
    id: "t5",
    subjectId: "brightline",
    statement: "Brightline pays invoices on the 15th, whatever the terms say.",
    toldAt: daysAgo(55),
    replaced: [
      {
        id: "t5-old2",
        statement: "Brightline pays invoices on the 1st.",
        toldAt: daysAgo(104),
        replacedAt: daysAgo(55),
      },
      {
        id: "t5-old1",
        statement: "Brightline pays invoices late, about two weeks after they're due.",
        toldAt: daysAgo(160),
        replacedAt: daysAgo(104),
      },
    ],
  },
  {
    id: "t6",
    subjectId: "northwind",
    statement: "Northwind only orders full truckloads.",
    toldAt: daysAgo(70),
    replaced: [],
  },
  {
    id: "t7",
    subjectId: "acme",
    statement: "Acme's loading dock closes at 3pm on Fridays.",
    toldAt: daysAgo(88),
    replaced: [],
  },
];

export const PRIVACY_NOTE =
  "Only you see these. Mycel uses them when you ask it something and when your own workflows look things up for your inbox. They're deleted if you leave the company.";
