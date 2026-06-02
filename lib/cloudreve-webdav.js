'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const DEFAULT_DAV_PATH = '/dav'
const DEFAULT_TIMEOUT = 30000

function trimSlashes (value) {
  return String(value || '').replace(/^\/+|\/+$/g, '')
}

function stripTrailingSlash (value) {
  return String(value || '').replace(/\/+$/g, '')
}

function normalizeBaseUrl (serverUrl) {
  if (!serverUrl || typeof serverUrl !== 'string') {
    throw new Error('Cloudreve 服务地址不能为空')
  }
  return stripTrailingSlash(serverUrl.trim())
}

function normalizeDavPath (davPath) {
  const clean = trimSlashes(davPath || DEFAULT_DAV_PATH)
  return clean ? `/${clean}` : ''
}

function normalizeRemoteDir (remotePath) {
  const clean = trimSlashes(remotePath || '')
  return clean ? `/${clean}` : ''
}

function normalizeApiPath (apiPath) {
  const clean = trimSlashes(apiPath || '')
  return clean ? `/${clean}` : ''
}

function encodePathSegments (pathname) {
  const clean = String(pathname || '').replace(/^\/+/, '')
  if (!clean) return ''
  return clean.split('/').filter(Boolean).map(segment => encodeURIComponent(segment)).join('/')
}

function joinUrlPath (...parts) {
  const clean = parts
    .map(part => trimSlashes(part))
    .filter(Boolean)
    .join('/')
  return clean ? `/${clean}` : ''
}

function joinRemotePath (remoteDir, fileName) {
  const safeName = String(fileName || '').replace(/[\\/]+/g, '_')
  return joinUrlPath(remoteDir, safeName)
}

function contentTypeFromExt (fileName) {
  const ext = path.extname(fileName || '').toLowerCase()
  const types = {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  }
  return types[ext] || 'application/octet-stream'
}

function normalizeBearerToken (token) {
  return String(token || '').replace(/^Bearer\s+/i, '').trim()
}

function buildBasicAuth (username, password) {
  if (!username || !password) {
    throw new Error('Cloudreve WebDAV 用户名和密码不能为空')
  }
  return Buffer.from(`${username}:${password}`).toString('base64')
}

function buildDavUrl (config, remotePath = '') {
  const baseUrl = normalizeBaseUrl(config.serverUrl)
  const url = new URL(baseUrl)
  const existing = trimSlashes(url.pathname)
  const dav = trimSlashes(config.davPath || DEFAULT_DAV_PATH)
  const remote = encodePathSegments(remotePath)
  url.pathname = [existing, dav, remote].filter(Boolean).join('/').replace(/^/, '/')
  return url
}

function normalizeFileUriPrefix (fileUriPrefix) {
  const raw = String(fileUriPrefix || 'cloudreve://my').replace(/\/+$/g, '')
  try {
    return new URL(raw).toString().replace(/\/+$/g, '')
  } catch (error) {
    return raw
  }
}

function buildCloudreveFileUri (config, remotePath) {
  const prefix = normalizeFileUriPrefix(config.fileUriPrefix)
  const cleanRemote = String(remotePath || '').replace(/^\/+/, '')
  const encodedRemote = encodePathSegments(cleanRemote)
  return encodedRemote ? `${prefix}/${encodedRemote}` : prefix
}

function buildPublicUrl (config, remotePath) {
  const encodedRemote = encodePathSegments(remotePath)
  const rawRemote = String(remotePath || '').replace(/^\/+/, '')

  if (config.publicUrlTemplate) {
    return String(config.publicUrlTemplate)
      .replace(/\{path\}/g, encodedRemote)
      .replace(/\{rawPath\}/g, rawRemote)
      .replace(/\{filename\}/g, encodeURIComponent(path.basename(rawRemote)))
      .replace(/\{rawFilename\}/g, path.basename(rawRemote))
  }

  if (config.publicUrlPrefix) {
    return `${stripTrailingSlash(config.publicUrlPrefix)}/${encodedRemote}`
  }

  const baseUrl = normalizeBaseUrl(config.serverUrl)
  return `${baseUrl}/${encodedRemote}`
}

function requestBuffer (url, options, body) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(url, options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      })
    })

    req.on('error', reject)
    req.setTimeout(options.timeout || DEFAULT_TIMEOUT, () => {
      req.destroy(new Error(`Cloudreve WebDAV 请求超时：${options.method || 'GET'} ${url.toString()}`))
    })

    if (body) req.write(body)
    req.end()
  })
}

function parseJsonResponse (response, label) {
  let payload
  try {
    payload = response.body ? JSON.parse(response.body) : {}
  } catch (error) {
    throw new Error(`${label} 返回了无效 JSON：HTTP ${response.statusCode}，${response.body}`)
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${label} 请求失败：HTTP ${response.statusCode}${response.body ? `，${response.body}` : ''}`)
  }

  if (typeof payload.code === 'number' && payload.code !== 0 && payload.code !== 203) {
    throw new Error(`${label} 失败：${payload.msg || payload.message || payload.code}`)
  }

  return payload
}

function buildApiUrl (config, apiPath) {
  const baseUrl = normalizeBaseUrl(config.serverUrl)
  const url = new URL(baseUrl)
  const existing = trimSlashes(url.pathname)
  const api = trimSlashes(apiPath)
  url.pathname = [existing, api].filter(Boolean).join('/').replace(/^/, '/')
  return url
}

class CloudreveWebDAVClient {
  constructor (config) {
    this.config = {
      davPath: DEFAULT_DAV_PATH,
      timeout: DEFAULT_TIMEOUT,
      ...config
    }
    this.auth = buildBasicAuth(this.config.username, this.config.password)
  }

  async request (method, remotePath, body, extraHeaders = {}) {
    const url = buildDavUrl(this.config, remotePath)
    const headers = {
      Authorization: `Basic ${this.auth}`,
      ...extraHeaders
    }
    const response = await requestBuffer(url, {
      method,
      headers,
      timeout: Number(this.config.timeout) || DEFAULT_TIMEOUT
    }, body)

    return response
  }


  async requestJson (method, apiPath, body, extraHeaders = {}) {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const response = await requestBuffer(buildApiUrl(this.config, apiPath), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...extraHeaders
      },
      timeout: Number(this.config.timeout) || DEFAULT_TIMEOUT
    }, payload)

    return parseJsonResponse(response, `Cloudreve API ${method} ${apiPath}`)
  }

  async getDirectLinksV4 (remotePaths) {
    if (!this.config.apiToken) {
      throw new Error('使用 Cloudreve v4 获取直链需要配置 API Token / JWT（Authorization Bearer Token）')
    }

    const uris = remotePaths.map(remotePath => buildCloudreveFileUri(this.config, remotePath))
    const payload = await this.requestJson('PUT', '/api/v4/file/source', { uris }, {
      Authorization: `Bearer ${normalizeBearerToken(this.config.apiToken)}`
    })

    const links = new Map()
    for (const item of payload.data || []) {
      if (item && item.file_url && item.link) links.set(item.file_url, item.link)
    }

    return uris.map(uri => {
      const link = links.get(uri)
      if (!link) throw new Error(`Cloudreve 未返回文件直链：${uri}`)
      return link
    })
  }

  async getV3FileId (remotePath) {
    if (!this.config.sessionCookie) {
      throw new Error('使用 Cloudreve v3 获取直链需要配置已登录会话 Cookie（cloudreve-session）')
    }

    const remote = String(remotePath || '').replace(/^\/+/g, '')
    const dir = normalizeRemoteDir(path.dirname(remote) === '.' ? '' : path.dirname(remote))
    const fileName = path.basename(remote)
    const payload = await this.requestJson('GET', `/api/v3/directory${dir || '/'}`, null, {
      Cookie: this.config.sessionCookie
    })
    const objects = payload.data && Array.isArray(payload.data.objects) ? payload.data.objects : []
    const matched = objects.find(item => item && item.name === fileName && item.type !== 'dir')
    if (!matched || !matched.id) {
      throw new Error(`Cloudreve v3 目录中未找到已上传文件：${remotePath}`)
    }
    return matched.id
  }

  async getDirectLinksV3 (remotePaths) {
    if (!this.config.sessionCookie) {
      throw new Error('使用 Cloudreve v3 获取直链需要配置已登录会话 Cookie（cloudreve-session）')
    }

    const ids = []
    for (const remotePath of remotePaths) {
      ids.push(await this.getV3FileId(remotePath))
    }

    const payload = await this.requestJson('POST', '/api/v3/file/source', { items: ids }, {
      Cookie: this.config.sessionCookie
    })
    const rows = Array.isArray(payload.data) ? payload.data : []
    return remotePaths.map((remotePath, index) => {
      const fileName = path.basename(String(remotePath || '').replace(/^\/+/g, ''))
      const row = rows.find(item => item && item.name === fileName) || rows[index]
      if (!row || row.error) throw new Error(`Cloudreve v3 获取直链失败：${remotePath}${row && row.error ? `，${row.error}` : ''}`)
      if (!row.url) throw new Error(`Cloudreve v3 未返回文件直链：${remotePath}`)
      return row.url
    })
  }

  async getDirectLinks (remotePaths) {
    const version = String(this.config.apiVersion || 'v4').toLowerCase()
    if (version === 'v3') return this.getDirectLinksV3(remotePaths)
    return this.getDirectLinksV4(remotePaths)
  }

  async ensureDirectory (remoteDir) {
    const normalized = normalizeRemoteDir(remoteDir)
    if (!normalized) return

    const segments = trimSlashes(normalized).split('/').filter(Boolean)
    let current = ''
    for (const segment of segments) {
      current = joinUrlPath(current, segment)
      const response = await this.request('MKCOL', current)
      if (![201, 405, 301, 302].includes(response.statusCode)) {
        throw new Error(`创建 Cloudreve 远程目录失败：${current}，HTTP ${response.statusCode}${response.body ? `，${response.body}` : ''}`)
      }
    }
  }

  async uploadBuffer (buffer, remotePath, contentType) {
    const response = await this.request('PUT', remotePath, buffer, {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': buffer.length
    })

    if (![200, 201, 204].includes(response.statusCode)) {
      throw new Error(`上传到 Cloudreve 失败：${remotePath}，HTTP ${response.statusCode}${response.body ? `，${response.body}` : ''}`)
    }

    return response
  }
}

function getFileBuffer (item) {
  if (Buffer.isBuffer(item.buffer)) return item.buffer
  if (item.base64Image) return Buffer.from(String(item.base64Image), 'base64')
  const filePath = item.path || item.file || item.input
  if (filePath) return fs.readFileSync(filePath)
  throw new Error(`无法读取待上传文件内容：${item.fileName || 'unknown'}`)
}

function getFileName (item, index, rename) {
  const original = item.fileName || item.name || (item.path ? path.basename(item.path) : '') || `image-${index + 1}`
  if (!rename) return original

  const ext = path.extname(original)
  const stem = path.basename(original, ext)
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  return `${stamp}-${index + 1}-${stem}${ext}`
}

function createUploadItem (input, output, index) {
  if (output && (output.buffer || output.base64Image || output.path || output.file || output.input)) {
    return output
  }
  if (typeof input === 'string') {
    return {
      path: input,
      fileName: path.basename(input)
    }
  }
  return input || output || {}
}

module.exports = {
  DEFAULT_DAV_PATH,
  DEFAULT_TIMEOUT,
  CloudreveWebDAVClient,
  buildApiUrl,
  buildCloudreveFileUri,
  buildDavUrl,
  buildPublicUrl,
  contentTypeFromExt,
  createUploadItem,
  getFileBuffer,
  getFileName,
  joinRemotePath,
  normalizeApiPath,
  normalizeBaseUrl,
  normalizeBearerToken,
  normalizeDavPath,
  normalizeFileUriPrefix,
  normalizeRemoteDir
}
