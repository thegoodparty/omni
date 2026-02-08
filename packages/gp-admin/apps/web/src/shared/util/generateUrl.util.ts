export type UrlConfig = {
  protocol: string
  domain: string
  port?: string
  rootPath?: string
}

export const generateUrl = ({
  protocol,
  domain,
  port,
  rootPath,
}: UrlConfig): URL => {
  const url = new URL(`${protocol}://${domain}`)
  if (port) url.port = port
  if (rootPath) url.pathname = rootPath
  return url
}
