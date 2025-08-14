import * as fs from "fs";

/** Simple {{KEY}} substitution without external deps */
export function renderTemplate(
  templatePath: string,
  data: Record<string, string>
): string {
  let out = fs.readFileSync(templatePath, "utf8");

  out = out.replace(/{{\s*([\w]+)\s*}}/g, (_, key) => {
    if (key in data) return data[key];
    return `{{${key}}}`; // preserve unknown placeholders instead of blanking them
  });

  return out;
}
