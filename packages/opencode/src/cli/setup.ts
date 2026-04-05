import * as prompts from "@clack/prompts"
import { Auth } from "../auth"
import { Config } from "../config/config"

async function fetchModels(baseURL: string, apiKey: string, spin: ReturnType<typeof prompts.spinner>) {
  spin.start("Fetching available models...")
  return fetch(`${baseURL}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<{ data: Array<{ id: string }> }>
    })
    .then((data) => {
      const list = data.data.map((m) => m.id).filter(Boolean)
      if (!list.length) throw new Error("No models returned")
      spin.stop(`Found ${list.length} models`)
      return list
    })
    .catch((err: unknown) => {
      spin.stop("Failed to fetch models")
      prompts.log.error(String(err))
      process.exit(1)
    })
}

export async function firstRunSetup(refresh = false) {
  const existing = await Auth.get("organization")
  if (existing && !refresh) return

  if (refresh && existing) {
    // Refresh path: re-use stored credentials, just re-fetch models
    const cfg = await Config.getGlobal()
    const baseURL = cfg.provider?.["organization"]?.options?.baseURL ?? ""
    if (!baseURL) {
      prompts.log.error("No API URL stored. Run opencode without --refresh to set up first.")
      process.exit(1)
    }
    prompts.intro("NeoCode — Refresh Models")
    const spin = prompts.spinner()
    const models = await fetchModels(baseURL, existing.type === "api" ? existing.key : "", spin)

    const selected = await prompts.select({
      message: "Select default model",
      options: models.map((id) => ({ label: id, value: id })),
    })
    if (prompts.isCancel(selected)) process.exit(0)

    await Config.updateGlobal({
      model: `organization/${selected}`,
      provider: {
        organization: {
          models: Object.fromEntries(models.map((id) => [id, { name: id }])),
        },
      },
    } as Config.Info)

    prompts.outro("Models updated!")
    return
  }

  // First-run path: prompt for credentials
  prompts.intro("NeoCode Setup")

  const url = await prompts.text({
    message: "NeoCode API URL",
    placeholder: "https://api.company.com",
    validate: (v) => {
      if (!v) return "Enter a valid URL"
      try {
        new URL(v)
        return undefined
      } catch {
        return "Enter a valid URL"
      }
    },
  })
  if (prompts.isCancel(url)) process.exit(0)

  const key = await prompts.password({
    message: "API Key",
    validate: (v) => (v ? undefined : "Required"),
  })
  if (prompts.isCancel(key)) process.exit(0)

  const spin = prompts.spinner()
  const models = await fetchModels(url as string, key as string, spin)

  const selected = await prompts.select({
    message: "Select default model",
    options: models.map((id) => ({ label: id, value: id })),
  })
  if (prompts.isCancel(selected)) process.exit(0)

  await Auth.set("organization", { type: "api", key: key as string })
  await Config.updateGlobal({
    model: `organization/${selected}`,
    provider: {
      organization: {
        options: { baseURL: url as string },
        models: Object.fromEntries(models.map((id) => [id, { name: id }])),
      },
    },
  } as Config.Info)

  prompts.outro("Setup complete!")
}
