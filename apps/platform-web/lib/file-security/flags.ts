import type { RendererFlags, RendererKey } from "./types";

const ENV_KEYS: Record<RendererKey | "global", string> = {
  global: "SAFE_PREVIEW_GLOBAL_ENABLED",
  pdf: "SAFE_PREVIEW_PDF_ENABLED",
  office: "SAFE_PREVIEW_OFFICE_ENABLED",
  svg: "SAFE_PREVIEW_SVG_ENABLED",
  html: "SAFE_PREVIEW_HTML_ENABLED",
  image: "SAFE_PREVIEW_IMAGE_ENABLED",
  media: "SAFE_PREVIEW_MEDIA_ENABLED",
  archive: "SAFE_PREVIEW_ARCHIVE_ENABLED",
  text: "SAFE_PREVIEW_TEXT_ENABLED",
  onlyOfficeV2: "ONLYOFFICE_V2_ENABLED",
};

function enabled(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export function getEnvironmentRendererFlags(): RendererFlags {
  return {
    global: enabled(ENV_KEYS.global),
    pdf: enabled(ENV_KEYS.pdf),
    office: enabled(ENV_KEYS.office),
    svg: enabled(ENV_KEYS.svg),
    html: enabled(ENV_KEYS.html),
    image: enabled(ENV_KEYS.image),
    media: enabled(ENV_KEYS.media),
    archive: enabled(ENV_KEYS.archive),
    text: enabled(ENV_KEYS.text),
    onlyOfficeV2: enabled(ENV_KEYS.onlyOfficeV2),
  };
}

export function applyRuntimeKills(
  environment: RendererFlags,
  killed: Partial<Record<RendererKey | "global", boolean>>,
): RendererFlags {
  const global = environment.global && killed.global !== true;
  return {
    global,
    pdf: global && environment.pdf && killed.pdf !== true,
    office: global && environment.office && killed.office !== true,
    svg: global && environment.svg && killed.svg !== true,
    html: global && environment.html && killed.html !== true,
    image: global && environment.image && killed.image !== true,
    media: global && environment.media && killed.media !== true,
    archive: global && environment.archive && killed.archive !== true,
    text: global && environment.text && killed.text !== true,
    onlyOfficeV2:
      global &&
      environment.onlyOfficeV2 &&
      killed.onlyOfficeV2 !== true,
  };
}
