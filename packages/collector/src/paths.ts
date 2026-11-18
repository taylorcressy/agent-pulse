import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
export function dataHome() {
  const configured = process.env.AGENTPULSE_DATA_DIR;
  return configured && isAbsolute(configured)
    ? configured
    : join(homedir(), ".agentpulse");
}
