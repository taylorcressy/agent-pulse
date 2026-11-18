import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { id } from "./io";
import {
  metric,
  project,
  projectIdentity,
  type Installation,
} from "./providers";
import type { Provider, Session } from "../../core/src/index";

export async function linuxTerminals(
  provider: Provider,
  installation: Installation,
  environment: string,
  now: number,
): Promise<Session[] | null> {
  if (process.platform !== "linux" || !process.getuid) return null;
  const uid = process.getuid();
  try {
    const pids = (await readdir("/proc"))
      .filter((pid) => /^\d+$/.test(pid))
      .slice(0, 4096);
    const output: Session[] = [];
    for (let cursor = 0; cursor < pids.length; cursor += 48) {
      const matches = await Promise.all(
        pids.slice(cursor, cursor + 48).map(async (pid) => {
          try {
            const root = "/proc/" + pid;
            if (
              (await stat(root)).uid !== uid ||
              (await readlink(root + "/exe")) !== installation.file
            )
              return;
            const details = await readFile(root + "/stat", "utf8");
            const fields = details
              .slice(details.lastIndexOf(")") + 2)
              .trim()
              .split(/\s+/);
            if (!Number(fields[4]) || !/^\d+$/.test(fields[19] ?? "")) return;
            const cwd = await readlink(root + "/cwd").catch(() => null);
            return {
              id: id(provider, environment, "pid", pid, fields[19]),
              provider,
              project: project(cwd),
              ...projectIdentity(cwd, environment),
              environment,
              state: "running-activity-unknown" as const,
              source: metric(
                "Linux current-user terminal process",
                now,
                null,
                installation.version,
              ),
            };
          } catch {
            return;
          }
        }),
      );
      output.push(...matches.filter((row) => row !== undefined));
      if (output.length >= 60) break;
    }
    return output.slice(0, 60);
  } catch {
    return null;
  }
}
