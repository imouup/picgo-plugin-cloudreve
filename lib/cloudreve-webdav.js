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
  buildDavUrl,
  buildPublicUrl,
  contentTypeFromExt,
  createUploadItem,
  getFileBuffer,
  getFileName,
  joinRemotePath,
  normalizeBaseUrl,
  normalizeDavPath,
  normalizeRemoteDir
}
