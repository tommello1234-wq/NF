/**
 * Conversor HTML → PDF usando puppeteer-core.
 *
 * Dois modos, escolhidos automaticamente:
 *  - Serverless (Vercel/AWS Lambda): usa @sparticuz/chromium — um Chromium
 *    empacotado feito pra rodar em ambiente sem Chrome instalado.
 *  - Local (dev): usa o Chrome/Edge já instalado no PC, sem baixar 170MB.
 *
 * Pra DANFE NF-e (A4): formato A4 padrão.
 * Pra DANFE NFC-e (bobina 80mm): largura fixa 80mm + altura auto.
 */

import puppeteer from 'puppeteer-core'
import { stat } from 'node:fs/promises'

const CHROME_PATHS = [
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/** True quando rodando em Vercel/AWS Lambda (sem Chrome no sistema). */
function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV,
  )
}

let chromePathCache: string | null | undefined = undefined

async function findChromeLocal(): Promise<string | null> {
  if (chromePathCache !== undefined) return chromePathCache
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH
  if (fromEnv) {
    try {
      await stat(fromEnv)
      chromePathCache = fromEnv
      return fromEnv
    } catch {}
  }
  for (const p of CHROME_PATHS) {
    try {
      await stat(p)
      chromePathCache = p
      return p
    } catch {}
  }
  chromePathCache = null
  return null
}

/** Resolve a configuração de launch conforme o ambiente. */
async function resolveLaunchConfig(): Promise<{
  executablePath: string
  args: string[]
  headless: boolean | 'shell'
}> {
  if (isServerless()) {
    // Import dinâmico pra não carregar o pacote (~70MB) em dev/local.
    const mod = await import('@sparticuz/chromium')
    const chromium = (mod as { default?: unknown }).default ?? mod
    const c = chromium as {
      args: string[]
      headless: boolean | 'shell'
      executablePath: () => Promise<string>
    }
    return {
      executablePath: await c.executablePath(),
      args: c.args,
      headless: c.headless,
    }
  }

  const local = await findChromeLocal()
  if (!local) {
    throw new Error(
      'Chrome/Edge não encontrado no sistema. Instale Google Chrome ou Microsoft Edge, ou defina PUPPETEER_EXECUTABLE_PATH no .env.',
    )
  }
  return {
    executablePath: local,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  }
}

export interface HtmlToPdfOptions {
  /** 'a4' (default) ou 'bobina-80mm' pra DANFE NFC-e */
  formato?: 'a4' | 'bobina-80mm'
}

/** Renderiza HTML em PDF. Throws se nenhum Chromium estiver disponível. */
export async function htmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
  const cfg = await resolveLaunchConfig()

  const browser = await puppeteer.launch({
    executablePath: cfg.executablePath,
    headless: cfg.headless,
    args: cfg.args,
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    const isBobina = opts.formato === 'bobina-80mm'
    const pdf = await page.pdf({
      format: isBobina ? undefined : 'A4',
      width: isBobina ? '80mm' : undefined,
      // altura automática pra bobina — puppeteer adapta
      height: isBobina ? undefined : undefined,
      printBackground: true,
      preferCSSPageSize: isBobina,
      margin: isBobina
        ? { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' }
        : { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export async function chromeDisponivel(): Promise<boolean> {
  if (isServerless()) return true
  return (await findChromeLocal()) !== null
}
