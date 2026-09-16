import path from "node:path";
import { config } from "../config.js";
import { safeJobId } from "../utils/paths.js";
import { JsonJobRepository } from "../../../ebs/core/src/infrastructure/jsonJobRepository.js";

/** Compatibility adapter. JsonJobRepository is the canonical Phase 1 implementation. */
export class JobStore extends JsonJobRepository {
  constructor(file = path.join(config.paths.dataDir, "jobs.json")) {
    super(file, safeJobId);
  }
}
