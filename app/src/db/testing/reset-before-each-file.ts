// Vitest setup file: every test file starts from an empty database.
import { afterAll, beforeAll } from "vitest";
import { closeDb } from "../client";
import { resetDatabase } from "./reset";

beforeAll(resetDatabase);
afterAll(closeDb);
