'use strict'

const assert = require('assert')
const http = require('http')
const { test } = require('node:test')
const {
  CloudreveWebDAVClient,
  buildApiUrl,
  buildCloudreveFileUri,
  buildDavUrl,
  buildPublicUrl,
  contentTypeFromExt,
  joinRemotePath,
  normalizeBaseUrl,
  normalizeBearerToken,
  normalizeRemoteDir
} = require('../lib/cloudreve-webdav')

test('normalizes Cloudreve server and remote paths', () => {
  assert.strictEqual(normalizeBaseUrl('https://cloud.example.com///'), 'https://cloud.example.com')
  assert.strictEqual(normalizeRemoteDir('Pictures/PicGo/'), '/Pictures/PicGo')
  assert.strictEqual(normalizeRemoteDir('/'), '')
  assert.strictEqual(normalizeBearerToken('Bearer abc.def'), 'abc.def')
})

test('builds WebDAV and API URLs with encoded path segments', () => {
  const davUrl = buildDavUrl({
    serverUrl: 'https://cloud.example.com/base/',
    davPath: '/dav/'
  }, '/图床/hello world.png')

  assert.strictEqual(davUrl.toString(), 'https://cloud.example.com/base/dav/%E5%9B%BE%E5%BA%8A/hello%20world.png')
  assert.strictEqual(
    buildApiUrl({ serverUrl: 'https://cloud.example.com/base/' }, '/api/v4/file/source').toString(),
    'https://cloud.example.com/base/api/v4/file/source'
  )
})

test('joins remote file paths safely', () => {
  assert.strictEqual(joinRemotePath('/Pictures/PicGo', 'a/b.png'), '/Pictures/PicGo/a_b.png')
  assert.strictEqual(joinRemotePath('', 'cat.png'), '/cat.png')
})

test('builds Cloudreve v4 file URIs for the direct link API', () => {
  assert.strictEqual(
    buildCloudreveFileUri({ fileUriPrefix: 'cloudreve://my/Bound Root/' }, '/Pictures/PicGo/a b.png'),
    'cloudreve://my/Bound%20Root/Pictures/PicGo/a%20b.png'
  )
})

test('builds legacy public URLs from prefix or template', () => {
  assert.strictEqual(
    buildPublicUrl({ publicUrlPrefix: 'https://img.example.com/static/' }, '/Pictures/PicGo/a b.png'),
    'https://img.example.com/static/Pictures/PicGo/a%20b.png'
  )

  assert.strictEqual(
    buildPublicUrl({ publicUrlTemplate: 'https://cdn.example.com/{path}?name={rawFilename}' }, '/图床/a b.png'),
    'https://cdn.example.com/%E5%9B%BE%E5%BA%8A/a%20b.png?name=a b.png'
  )
})

test('detects common image content types', () => {
  assert.strictEqual(contentTypeFromExt('a.JPG'), 'image/jpeg')
  assert.strictEqual(contentTypeFromExt('a.webp'), 'image/webp')
  assert.strictEqual(contentTypeFromExt('a.bin'), 'application/octet-stream')
})

test('gets Cloudreve v4 direct links from the file source API', async () => {
  const server = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'PUT')
    assert.strictEqual(req.url, '/api/v4/file/source')
    assert.strictEqual(req.headers.authorization, 'Bearer test-token')

    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      assert.deepStrictEqual(body, {
        uris: ['cloudreve://my/Pictures/PicGo/cat.png']
      })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        code: 0,
        data: [{
          file_url: 'cloudreve://my/Pictures/PicGo/cat.png',
          link: 'https://cloud.example.com/f/abc/cat.png'
        }],
        msg: ''
      }))
    })
  })

  await new Promise(resolve => server.listen(0, resolve))
  try {
    const { port } = server.address()
    const client = new CloudreveWebDAVClient({
      serverUrl: `http://127.0.0.1:${port}`,
      username: 'user@example.com',
      password: 'webdav-password',
      apiToken: 'Bearer test-token',
      apiVersion: 'v4'
    })

    const links = await client.getDirectLinks(['/Pictures/PicGo/cat.png'])
    assert.deepStrictEqual(links, ['https://cloud.example.com/f/abc/cat.png'])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
