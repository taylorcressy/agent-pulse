import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { dataHome } from "./paths";
import { clean, date, id, integer, obj, parse, walk } from "./io";
import { home, metric, quotaWindow } from "./providers";
import { percentage, type QuotaWindow } from "../../core/src/index";

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const managedSettings = () =>
  process.platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-settings.json"
    : "/etc/claude-code/managed-settings.json";
const bridgeProgram = String.raw`
const fs=require("node:fs"), cp=require("node:child_process"), path=require("node:path");
const dir=__dirname;
const chunks=[];
let bytes=0;
let child;
try{
  const previous=JSON.parse(fs.readFileSync(path.join(dir,"statusline-backup.json"),"utf8")).prior;
  if(typeof previous?.command==="string"){
    child=cp.spawn(previous.command,{shell:true,stdio:["pipe","inherit","inherit"]});
    child.on("exit",code=>{process.exitCode=code??1});
    child.on("error",()=>{process.exitCode=1});
    child.stdin.on("error",()=>{});
    process.stdin.pipe(child.stdin);
  }
}catch{}
process.stdin.on("data",chunk=>{bytes+=chunk.length;if(bytes<=1048576)chunks.push(chunk)});
process.stdin.on("end",()=>{
  if(bytes>1048576)return;
  try{
    const data=JSON.parse(Buffer.concat(chunks));
    if(!/^[\w.-]{1,128}$/.test(data.session_id))return;
    const limits={};
    for(const key of ["five_hour","seven_day","spend_limit"]){
      const row=data.rate_limits?.[key];
      if(row)limits[key]={used_percentage:row.used_percentage,resets_at:row.resets_at};
    }
    const context=data.context_window;
    const output={id:data.session_id,time:Date.now(),limits,context:context?.used_percentage,capacity:context?.context_window_size};
    const file=path.join(dir,"telemetry",data.session_id+".json");
    const tmp=file+"."+process.pid+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(output),{mode:0o600});
    fs.renameSync(tmp,file);
  }catch{}
});
`;
async function boundedFile(path: string) {
  if ((await stat(path)).size > 1024 * 1024)
    throw new Error("Configuration file exceeds size limit");
  return readFile(path, "utf8");
}
async function optionalFile(path: string) {
  try {
    return await boundedFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function bridge(
  action: "preview" | "enable" | "disable",
  reviewed?: string,
) {
  if (process.platform === "win32")
    return "Bridge installation requires a validated native shell adapter on Windows.";
  if ((await optionalFile(managedSettings())) !== null)
    return "Managed Claude configuration was detected. Bridge changes are disabled.";
  const directory = dataHome(),
    settings = join(home("claude"), "settings.json");
  const backupFile = join(directory, "statusline-backup.json");
  const script = join(directory, "statusline.cjs");
  const original = await optionalFile(settings);
  const raw = original ?? "{}";
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Claude settings must contain a JSON object");
  const current = obj(parsed);
  const explicitNode = process.env.AGENTPULSE_NODE_PATH;
  const embedded =
    !explicitNode && process.env.AGENTPULSE_ELECTRON_CHILD === "1";
  if (embedded && process.env.APPIMAGE)
    return "Enable the bridge from the standalone companion when running the AppImage.";
  const nodePath = explicitNode ?? process.execPath;
  const command = `${embedded ? "ELECTRON_RUN_AS_NODE=1 " : ""}${quote(nodePath)} ${quote(script)}`;
  const replacement = { ...obj(current.statusLine), type: "command", command };
  const backup = obj(parse((await optionalFile(backupFile)) ?? ""));
  const active =
    typeof backup.command === "string" &&
    obj(current.statusLine).command === backup.command;
  const preview = active
    ? `Remove this AgentPulse status line and restore the saved statusLine setting.\n\n${JSON.stringify(current.statusLine, null, 2)}\n→\n${JSON.stringify(backup.prior ?? null, null, 2)}`
    : `Replace this Claude statusLine setting with the AgentPulse bridge. Existing command output is preserved.\n\n${JSON.stringify(current.statusLine ?? null, null, 2)}\n→\n${JSON.stringify(replacement, null, 2)}`;
  if (action === "preview") return preview;
  if (
    preview !== reviewed ||
    (active ? action !== "disable" : action !== "enable")
  )
    throw new Error(
      "Claude settings changed or the preview expired. Review the current change before applying.",
    );
  if (action === "enable") {
    if (Object.keys(backup).length)
      throw new Error(
        "Bridge backup already exists. Review the current Claude settings before overwriting it.",
      );
    if (
      current.statusLine &&
      (obj(current.statusLine).type !== "command" ||
        typeof obj(current.statusLine).command !== "string")
    )
      throw new Error("Unknown statusLine format");
    await mkdir(join(directory, "telemetry"), { recursive: true, mode: 0o700 });
    await writeFile(script, bridgeProgram, { mode: 0o600 });
    await writeFile(
      backupFile,
      JSON.stringify({
        prior: current.statusLine,
        command,
        enabledAt: Date.now(),
      }),
      { mode: 0o600, flag: "wx" },
    );
    current.statusLine = replacement;
  } else {
    if (!active)
      throw new Error(
        "Claude statusLine changed. The saved setting is still available for manual recovery.",
      );
    if (
      JSON.stringify(current.statusLine) !==
      JSON.stringify({
        ...obj(backup.prior),
        type: "command",
        command: backup.command,
      })
    )
      throw new Error(
        "Claude statusLine changed. Review its current options before restoring.",
      );
    if (backup.prior === undefined) delete current.statusLine;
    else current.statusLine = backup.prior;
  }
  const temporary = join(
    home("claude"),
    ".agentpulse-" + randomUUID() + ".tmp",
  );
  try {
    await writeFile(temporary, JSON.stringify(current, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    if ((await optionalFile(settings)) !== original)
      throw new Error("Claude settings changed concurrently");
    await rename(temporary, settings);
  } catch (error) {
    if (action === "enable") await unlink(backupFile).catch(() => {});
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
  if (action === "disable") await unlink(backupFile);
  return action === "enable"
    ? "Bridge enabled. Metrics appear after a supported Claude session sends status-line updates. Reopen Claude if it does not reload settings."
    : "Previous Claude status line restored. Existing sessions may need to reload settings.";
}
export async function telemetry(now: number, environment: string) {
  const backup = obj(
    parse(
      (await optionalFile(join(dataHome(), "statusline-backup.json")).catch(
        () => null,
      )) ?? "",
    ),
  );
  const enabledAt = integer(backup.enabledAt);
  if (enabledAt === undefined) return { windows: [], values: [] };
  const current = obj(
    parse(
      (await optionalFile(join(home("claude"), "settings.json")).catch(
        () => null,
      )) ?? "",
    ),
  );
  if (obj(current.statusLine).command !== backup.command)
    return { windows: [], values: [] };
  const files = await walk(
    join(dataHome(), "telemetry"),
    (name) => name.endsWith(".json"),
    0,
    128,
  ).catch(() => []);
  const rows = await Promise.all(
    files.map(async (path) => {
      try {
        const row = obj(parse(await boundedFile(path)));
        const at = date(row.time),
          native = clean(row.id);
        if (!at || at < enabledAt || at > now + 60_000 || !native) return;
        return {
          at,
          key: id("claude", environment, native),
          context: percentage.safeParse(row.context).data,
          capacity: integer(row.capacity),
          limits: obj(row.limits),
        };
      } catch {
        return;
      }
    }),
  );
  const values = rows
    .filter((row) => row !== undefined)
    .sort((a, b) => b.at - a.at);
  const latest = values.find((row) => Object.keys(row.limits).length);
  const windows: QuotaWindow[] = latest
    ? Object.entries(latest.limits).flatMap(([key, value]) => {
        const label = {
          five_hour: "5-hour allowance",
          seven_day: "7-day allowance",
          spend_limit: "Gateway spend cap",
        }[key];
        if (!label) return [];
        const data = obj(value);
        return [
          quotaWindow(
            key,
            label,
            data.used_percentage,
            data.resets_at,
            metric(
              "Claude status line",
              now,
              latest.at,
              undefined,
              "account-reported",
            ),
          ),
        ];
      })
    : [];
  return { windows, values };
}
