/**
 * Output parser — thin re-export of parseAIAnswer for backwards compat.
 *
 * The actual implementation lives in answer-schema.ts (kept there so the
 * schema + parser live together). This file exists so consumers can
 * `import { parseAIAnswer } from "@statehub/ai/output-parser"` if they
 * prefer the module-name symmetry with the other ai package modules.
 */
export { parseAIAnswer, AIOutputParseError } from "./answer-schema";
